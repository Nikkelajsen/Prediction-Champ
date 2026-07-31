// Server-side funktion (kører på Vercel, ikke i browseren).
// Sender push-notifikationer til tilmeldte brugere:
//   1) Deadline-påmindelse: runder der mangler tips og låser inden for de næste timer.
//      Låsningen er RUNDE-baseret (som i sql/predictions_round_lock_policies.sql og
//      frontendens isLocked): alle kampe i en runde — samme (season_id, round_key) —
//      låser samtidig, 1 time før rundens tidligste kickoff.
//   2) Runde-resultat: når alle kampe i en runde er færdigspillede — point + placering,
//      læst fra DB-viewet round_standings (samme kilde som Championship-fanen).
// notification_log sikrer, at samme besked aldrig sendes to gange.
//
// Kald med: /api/send-notifications  med headeren  x-sync-secret: <SYNC_SECRET>  (ekstern cron)
//   (?secret=<SYNC_SECRET> virker stadig som fallback, men er på vej ud — ROADMAP A11.
//    Brug ikke den form til nye jobs: hemmeligheden havner i request-logs.)
//   valgfrit: &hours=3      hvor tæt på rundelåsen deadline-påmindelsen sendes
//   valgfrit: &dryRun=true  vis hvad der VILLE blive sendt, uden at sende
// Offentligt: /api/send-notifications?action=vapidKey  (bruges af frontendens tilmelding)
//
// Miljøvariabler der skal være sat i Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (generér med: npx web-push generate-vapid-keys)
//   VAPID_SUBJECT (valgfri, mailto:-adresse til push-tjenesterne)

import webpush from "web-push";
import { createSb, isAuthorized, createRunLogger, failJob } from "./_shared.js";

const HOUR = 3600 * 1000;
const LOCK_LEAD_MS = HOUR; // runden låser 1 time før sin tidligste kickoff

function roundLabel(key) {
  const start = new Date(key + "T12:00:00");
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
// Delt placering på rundens stilling. Samme regel som src/lib/standings.js, som er
// den kanoniske kilde — den duplikeres her, fordi api/ ikke importerer fra src/
// (samme grund som roundLabel ovenfor). Rækkerne kommer allerede sorteret fra
// databasen, så det er nok at sammenligne med naboen.
function assignRanks(board) {
  const tied = (a, b) => a.total_points === b.total_points
    && a.exact_count === b.exact_count
    && (a.outcome_count ?? 0) === (b.outcome_count ?? 0)
    && Number(a.avg_goal_error ?? 0) === Number(b.avg_goal_error ?? 0);
  let rank = 0;
  board.forEach((r, i) => {
    const tiedWithPrev = i > 0 && tied(board[i - 1], r);
    if (!tiedWithPrev) rank = i + 1;
    r.rank = rank;
    r.shared = tiedWithPrev;
  });
  for (let i = 0; i < board.length - 1; i++) if (board[i + 1].shared) board[i].shared = true;
  return board;
}
function fmtUntil(ts) {
  let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

export default async function handler(req, res) {
  // Sættes så snart autorisationen er i hus. Ligger uden for try'et, fordi
  // catch'en skal kunne bruge den — en kørsel, der vælter, er netop den, der
  // skal ende i job_runs.
  let run = null;
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SYNC_SECRET = process.env.SYNC_SECRET;
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:notifications@prediction-champ.invalid";

    // Offentligt endpoint: frontendens tilmelding henter den offentlige VAPID-nøgle her,
    // så nøglen kun findes ét sted (Vercels miljøvariabler).
    if (req.query.action === "vapidKey") {
      if (!VAPID_PUBLIC_KEY) return res.status(500).json({ error: "VAPID_PUBLIC_KEY er ikke sat i Vercel-projektet" });
      return res.status(200).json({ publicKey: VAPID_PUBLIC_KEY });
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Miljøvariabler mangler i Vercel-projektet (SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY)" });
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: "VAPID-nøgler mangler i Vercel-projektet (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" });
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const sb = createSb(SUPABASE_URL, SERVICE_KEY);

    // ---- autorisation: enten en admin-brugers login, eller den delte hemmelige nøgle (til ekstern cron) ----
    // Reglerne bor i api/_shared.js, så de er ens for alle tre job-endpoints.
    const auth = await isAuthorized(req, {
      sb,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      syncSecret: SYNC_SECRET,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const dryRun = req.query.dryRun === "true";
    const horizonHours = Math.min(24, Math.max(1, Number(req.query.hours) || 3));
    run = createRunLogger(sb, "send-notifications", { skip: dryRun });

    // tilmeldte enheder, grupperet pr. bruger — er ingen tilmeldt, er der intet at gøre
    const subs = await sb(`/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth`);
    if (!subs.length) return run.ok(res, { sent: 0, note: "Ingen tilmeldte enheder" });
    const subsByUser = {};
    for (const s of subs) (subsByUser[s.user_id] ||= []).push(s);
    const subscribedUsers = Object.keys(subsByUser);

    // planlagte beskeder: { userId, key, title, body, tag }
    const outbox = [];
    const now = Date.now();

    // ================= 1) Deadline-påmindelser =================
    // Runder hvis lås (tidligste kickoff − 1 time) rammes inden for de næste horizonHours
    // timer, og hvor ingen kamp har fået resultat endnu. Kickoff-vinduet nu-7d..nu+8d
    // dækker alle kampe i de runder, der endnu ikke er låst (runder spænder tirs–man).
    {
      const from = new Date(now - 7 * 24 * HOUR).toISOString();
      const to = new Date(now + 8 * 24 * HOUR).toISOString();
      const ms = await sb(`/rest/v1/matches?kickoff_at=gte.${from}&kickoff_at=lte.${to}&select=id,season_id,round_key,kickoff_at,home_score`);
      const byRound = {};
      for (const m of ms) {
        if (!m.kickoff_at) continue;
        (byRound[`${m.season_id ?? ""}|${m.round_key ?? ""}`] ||= []).push(m);
      }
      const lockingRounds = Object.values(byRound).filter((list) => {
        if (list.some((m) => m.home_score != null)) return false; // resultat ⇒ runden er allerede låst
        const lockAt = Math.min(...list.map((m) => new Date(m.kickoff_at).getTime())) - LOCK_LEAD_MS;
        return lockAt > now && lockAt <= now + horizonHours * HOUR;
      });

      if (lockingRounds.length) {
        const matchIds = lockingRounds.flatMap((list) => list.map((m) => m.id));
        // hvilke brugere er kampene relevante for? (deltagere i konkurrencer, kampene indgår i)
        const cms = await sb(`/rest/v1/competition_matches?match_id=in.(${matchIds.join(",")})&select=competition_id,match_id`);
        const compIds = [...new Set(cms.map((c) => c.competition_id))];
        const parts = compIds.length
          ? await sb(`/rest/v1/competition_participants?competition_id=in.(${compIds.join(",")})&select=competition_id,user_id`)
          : [];
        const usersByComp = {};
        for (const p of parts) (usersByComp[p.competition_id] ||= new Set()).add(p.user_id);
        const usersByMatch = {};
        for (const c of cms) {
          for (const uid of usersByComp[c.competition_id] || []) (usersByMatch[c.match_id] ||= new Set()).add(uid);
        }
        const preds = await sb(`/rest/v1/predictions?match_id=in.(${matchIds.join(",")})&select=user_id,match_id,pred_home,pred_away`);
        const tipped = new Set(preds.filter((p) => p.pred_home != null && p.pred_away != null).map((p) => `${p.match_id}:${p.user_id}`));

        const today = new Date().toISOString().slice(0, 10);
        for (const list of lockingRounds) {
          const { season_id, round_key } = list[0];
          const lockAt = Math.min(...list.map((m) => new Date(m.kickoff_at).getTime())) - LOCK_LEAD_MS;
          for (const uid of subscribedUsers) {
            const missing = list.filter((m) => usersByMatch[m.id]?.has(uid) && !tipped.has(`${m.id}:${uid}`));
            if (!missing.length) continue;
            outbox.push({
              userId: uid,
              key: `deadline:${season_id ?? ""}:${round_key}:${today}`, // maks. én påmindelse pr. runde pr. dag
              title: "Runden låser snart ⏰",
              body: `${missing.length} ${missing.length === 1 ? "kamp mangler" : "kampe mangler"} dine tips — runden låser om ${fmtUntil(lockAt)}.`,
              tag: `deadline-${round_key}`,
              kind: "deadline",
              roundKey: round_key,
            });
          }
        }
      }
    }

    // ================= 2) Runde-resultater =================
    // Runder fra de seneste 14 dage, hvor ALLE kampe har fået resultat: point + placering
    // fra round_standings-viewet (på tværs af ligaer, som Championship-fanens rundeliga).
    {
      const fromKey = new Date(now - 14 * 24 * HOUR).toISOString().slice(0, 10);
      const ms = await sb(`/rest/v1/matches?round_key=gte.${fromKey}&select=id,round_key,home_score,away_score`);
      const byRound = {};
      for (const m of ms) (byRound[m.round_key] ||= []).push(m);
      const finishedRounds = Object.entries(byRound)
        .filter(([, list]) => list.length > 0 && list.every((m) => m.home_score != null && m.away_score != null));

      for (const [roundKey] of finishedRounds) {
        // samme kilde og samme tiebreaker-stige som Championship-fanens rundeliga
        // (sql/standings_tiebreakers.sql). En runde har ingen rundesejre at bryde
        // lighed med, så stigen er point → præcise → udfald → målafvigelse.
        const board = await sb(`/rest/v1/round_standings?round_key=eq.${roundKey}&select=user_id,total_points,exact_count,outcome_count,avg_goal_error&order=total_points.desc,exact_count.desc,outcome_count.desc,avg_goal_error.asc,user_id.asc`);
        assignRanks(board);

        for (const r of board) {
          if (!subsByUser[r.user_id]) continue;
          const champ = r.rank === 1;
          const pos = r.shared ? `delt nr. ${r.rank}` : `nr. ${r.rank}`;
          outbox.push({
            userId: r.user_id,
            key: `result:${roundKey}`,
            title: champ
              ? (r.shared ? "Du er delt Rundens Prediction Champ! 🏆" : "Du er Rundens Prediction Champ! 🏆")
              : "Runden er slut ⚽",
            body: `Runden ${roundLabel(roundKey)}: du fik ${r.total_points} point og blev ${pos} af ${board.length}.`,
            tag: `result-${roundKey}`,
            kind: "result",
            roundKey,
          });
        }
      }
    }

    if (!outbox.length) return run.ok(res, { sent: 0, note: "Intet at sende lige nu" });

    // ---- dedup mod notification_log ----
    // Dette første filter er kun en optimering (spring beskeder over, en tidligere
    // kørsel allerede har sendt). Den EGENTLIGE sikring mod dubletter er "claim"-
    // trinnet nedenfor: vi skriver til notification_log FØR vi sender, og sender kun
    // de rækker, netop denne kørsel selv fik indsat. Ellers taber check-derefter-send
    // et kapløb, hvis to kald til funktionen kører samtidig (fx flere cron-job, der
    // rammer endpointet på samme minut, eller overlappende kørsler): begge læser en
    // tom log, begge sender — og brugeren får to ens notifikationer på samme tid.
    const userIds = [...new Set(outbox.map((o) => o.userId))];
    const keys = [...new Set(outbox.map((o) => o.key))];
    const logged = await sb(`/rest/v1/notification_log?user_id=in.(${userIds.join(",")})&key=in.(${keys.map((k) => encodeURIComponent(`"${k}"`)).join(",")})&select=user_id,key`);
    const alreadySent = new Set(logged.map((l) => `${l.user_id}:${l.key}`));
    const candidates = outbox.filter((o) => !alreadySent.has(`${o.userId}:${o.key}`));

    if (dryRun) {
      return run.ok(res, {
        dryRun: true,
        note: "Intet er sendt eller logget — dette er kun en forhåndsvisning.",
        wouldSend: candidates.map(({ userId, key, title, body }) => ({ userId, key, title, body })),
      });
    }
    if (!candidates.length) return run.ok(res, { sent: 0, note: "Alt er allerede sendt" });

    // ---- claim: reservér beskederne i notification_log FØR de sendes ----
    // resolution=ignore-duplicates ⇒ rækker, som en anden (samtidig eller tidligere)
    // kørsel allerede har taget, springes over og returneres IKKE. Kun de rækker,
    // dette kald selv indsatte, kommer retur — og kun dem sender vi. Dermed er
    // indsættelsen den atomare lås, der forhindrer to samtidige kørsler i at sende
    // den samme besked hver især.
    const claimed = (await sb(`/rest/v1/notification_log?on_conflict=user_id,key`, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: JSON.stringify(candidates.map((o) => ({ user_id: o.userId, key: o.key }))),
    })) || [];
    const claimedSet = new Set(claimed.map((r) => `${r.user_id}:${r.key}`));
    const toSend = candidates.filter((o) => claimedSet.has(`${o.userId}:${o.key}`));
    if (!toSend.length) return run.ok(res, { sent: 0, note: "Alt er allerede sendt (taget af en anden kørsel)" });

    // ---- send + ryd døde abonnementer op ----
    let sent = 0;
    const deadSubIds = new Set();
    // Beskeder, der er "claimet" i notification_log men fejlede ved afsendelse,
    // er PERMANENT tabt: claim-rækken forhindrer, at en senere kørsel prøver
    // igen. Det er prisen for race-sikkerheden (se claim-trinnet ovenfor), og
    // den er bevidst — men indtil nu blev tabet slugt uden at blive talt.
    let failed = 0;
    const failureSamples = [];
    for (const msg of toSend) {
      // ?pn=<kind>&rk=<round> lader klienten logge push_opened med kontekst
      // (analytics v1) — der skrives ingen event her server-side, kun URL'en.
      const url = `/?pn=${encodeURIComponent(msg.kind || "")}&rk=${encodeURIComponent(msg.roundKey || "")}`;
      const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url });
      for (const s of subsByUser[msg.userId] || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            deadSubIds.add(s.id); // enheden er afmeldt — normal oprydning, ikke en fejl
          } else {
            // Alt andet (netværksfejl, 5xx fra push-tjenesten) betyder en tabt besked.
            failed++;
            if (failureSamples.length < 5) {
              failureSamples.push(`${e.statusCode ?? "?"}: ${String(e.message ?? e).slice(0, 200)}`);
            }
            console.error(
              `[send-notifications] Besked tabt for bruger ${msg.userId} (${msg.key}):`,
              e.statusCode ?? "",
              e.message ?? e
            );
          }
        }
      }
    }
    if (deadSubIds.size) {
      await sb(`/rest/v1/push_subscriptions?id=in.(${[...deadSubIds].join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    }

    // Delvist tab holder kørslen "vellykket": jobbet gjorde sit arbejde, og en
    // enkelt push-tjeneste, der hikker, skal ikke udløse alarm. Slap INTET
    // igennem, selvom der var noget at sende, er kørslen derimod mislykket —
    // det er signaturen på udløbne VAPID-nøgler eller en nede push-tjeneste.
    const detail = {
      sent,
      messages: toSend.length,
      removedSubscriptions: deadSubIds.size,
      failed,
      ...(failureSamples.length ? { failureSamples } : {}),
    };
    if (failed > 0 && sent === 0) {
      return run.fail(res, 200, detail, `Alle ${failed} afsendelser fejlede. ${failureSamples.join(" | ")}`);
    }
    return run.ok(res, detail);
  } catch (e) {
    return failJob(run, res, e, "send-notifications");
  }
}
