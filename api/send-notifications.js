// Server-side funktion (kører på Vercel, ikke i browseren).
// Sender push-notifikationer til tilmeldte brugere:
//   1) Deadline-påmindelse: kampe der mangler tips og låser inden for de næste timer.
//   2) Runde-resultat: når alle kampe i en runde er færdigspillede — point + placering.
// notification_log sikrer, at samme besked aldrig sendes to gange.
//
// Kald med: /api/send-notifications?secret=<SYNC_SECRET>          (ekstern cron)
//   valgfrit: &hours=3      hvor tæt på låsning deadline-påmindelsen sendes
//   valgfrit: &dryRun=true  vis hvad der VILLE blive sendt, uden at sende
// Offentligt: /api/send-notifications?action=vapidKey  (bruges af frontendens tilmelding)
//
// Miljøvariabler der skal være sat i Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNC_SECRET
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (generér med: npx web-push generate-vapid-keys)
//   VAPID_SUBJECT (valgfri, mailto:-adresse til push-tjenesterne)

import webpush from "web-push";

// ---- scoring (samme regler som frontendens scoring.js — bevidst duplikeret,
// så serverfunktionen ikke afhænger af frontend-moduler) ----
const RULES = { exact: 3, outcome: 1 };
function outcome(h, a) { return h === a ? "X" : h > a ? "1" : "2"; }
function pointsFor(pred, m) {
  if (!pred || m.home_score == null || m.away_score == null || pred.pred_home == null || pred.pred_away == null) return null;
  if (pred.pred_home === m.home_score && pred.pred_away === m.away_score) return RULES.exact;
  if (outcome(pred.pred_home, pred.pred_away) === outcome(m.home_score, m.away_score)) return RULES.outcome;
  return 0;
}
function roundLabel(key) {
  const start = new Date(key + "T12:00:00");
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (x) => x.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function fmtUntil(ts) {
  let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

export default async function handler(req, res) {
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

    async function sb(path, opts = {}) {
      const headers = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      };
      const r = await fetch(`${SUPABASE_URL}${path}`, { method: opts.method, headers, body: opts.body });
      if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
      if (r.status === 204) return null;
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    }

    // ---- autorisation: enten en admin-brugers login, eller den delte hemmelige nøgle (til ekstern cron) ----
    async function isAuthorized() {
      if (SYNC_SECRET && req.query.secret === SYNC_SECRET) return true;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const userToken = authHeader.slice(7);
        try {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${userToken}` },
          });
          if (!userRes.ok) return false;
          const user = await userRes.json();
          const profs = await sb(`/rest/v1/profiles?id=eq.${user.id}&select=is_admin`);
          return !!profs[0]?.is_admin;
        } catch (e) { return false; }
      }
      return false;
    }
    if (!(await isAuthorized())) {
      return res.status(401).json({ error: "Ikke autoriseret" });
    }

    const dryRun = req.query.dryRun === "true";
    const horizonHours = Math.min(24, Math.max(1, Number(req.query.hours) || 3));

    // tilmeldte enheder, grupperet pr. bruger — er ingen tilmeldt, er der intet at gøre
    const subs = await sb(`/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth`);
    if (!subs.length) return res.status(200).json({ sent: 0, note: "Ingen tilmeldte enheder" });
    const subsByUser = {};
    for (const s of subs) (subsByUser[s.user_id] ||= []).push(s);
    const subscribedUsers = Object.keys(subsByUser);

    // planlagte beskeder: { userId, key, title, body, tag }
    const outbox = [];
    const now = Date.now();
    const HOUR = 3600 * 1000;

    // ================= 1) Deadline-påmindelser =================
    // Kampe uden resultat, der låser (kickoff − 1 time) inden for de næste horizonHours timer.
    {
      const from = new Date(now + HOUR).toISOString();
      const to = new Date(now + HOUR + horizonHours * HOUR).toISOString();
      const ms = await sb(`/rest/v1/matches?home_score=is.null&kickoff_at=gte.${from}&kickoff_at=lte.${to}&select=id,round_key,kickoff_at`);
      if (ms.length) {
        const matchIds = ms.map((m) => m.id);
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
        for (const uid of subscribedUsers) {
          // manglende tips pr. runde for denne bruger
          const missingByRound = {};
          for (const m of ms) {
            if (!usersByMatch[m.id]?.has(uid)) continue;
            if (tipped.has(`${m.id}:${uid}`)) continue;
            (missingByRound[m.round_key] ||= []).push(m);
          }
          for (const [roundKey, missing] of Object.entries(missingByRound)) {
            const firstLock = Math.min(...missing.map((m) => new Date(m.kickoff_at).getTime() - HOUR));
            outbox.push({
              userId: uid,
              key: `deadline:${roundKey}:${today}`, // max én påmindelse pr. runde pr. dag
              title: "Tips mangler ⏰",
              body: `${missing.length} ${missing.length === 1 ? "kamp mangler" : "kampe mangler"} dine tips — låser om ${fmtUntil(firstLock)}.`,
              tag: `deadline-${roundKey}`,
            });
          }
        }
      }
    }

    // ================= 2) Runde-resultater =================
    // Runder fra de seneste 14 dage, hvor ALLE kampe har fået resultat: point + placering.
    {
      const fromKey = new Date(now - 14 * 24 * HOUR).toISOString().slice(0, 10);
      const ms = await sb(`/rest/v1/matches?round_key=gte.${fromKey}&select=id,round_key,home_score,away_score`);
      const byRound = {};
      for (const m of ms) (byRound[m.round_key] ||= []).push(m);
      const finishedRounds = Object.entries(byRound)
        .filter(([, list]) => list.length > 0 && list.every((m) => m.home_score != null && m.away_score != null));

      for (const [roundKey, list] of finishedRounds) {
        const matchIds = list.map((m) => m.id);
        const preds = await sb(`/rest/v1/predictions?match_id=in.(${matchIds.join(",")})&select=user_id,match_id,pred_home,pred_away`);
        const matchById = new Map(list.map((m) => [m.id, m]));
        const byUser = {};
        for (const p of preds) {
          const pts = pointsFor(p, matchById.get(p.match_id));
          if (pts == null) continue;
          const u = (byUser[p.user_id] ||= { total: 0, exactCount: 0 });
          u.total += pts;
          if (p.pred_home === matchById.get(p.match_id).home_score && p.pred_away === matchById.get(p.match_id).away_score) u.exactCount++;
        }
        const board = Object.entries(byUser)
          .map(([uid, u]) => ({ uid, ...u }))
          .sort((a, b) => b.total - a.total || b.exactCount - a.exactCount);
        board.forEach((r, i) => { r.rank = i + 1; });

        for (const r of board) {
          if (!subsByUser[r.uid]) continue;
          const champ = r.rank === 1;
          outbox.push({
            userId: r.uid,
            key: `result:${roundKey}`,
            title: champ ? "Du er Rundens Prediction Champ! 🏆" : "Runden er slut ⚽",
            body: `Runden ${roundLabel(roundKey)}: du fik ${r.total} point og blev nr. ${r.rank} af ${board.length}.`,
            tag: `result-${roundKey}`,
          });
        }
      }
    }

    if (!outbox.length) return res.status(200).json({ sent: 0, note: "Intet at sende lige nu" });

    // ---- dedup mod notification_log ----
    const userIds = [...new Set(outbox.map((o) => o.userId))];
    const keys = [...new Set(outbox.map((o) => o.key))];
    const logged = await sb(`/rest/v1/notification_log?user_id=in.(${userIds.join(",")})&key=in.(${keys.map((k) => encodeURIComponent(`"${k}"`)).join(",")})&select=user_id,key`);
    const alreadySent = new Set(logged.map((l) => `${l.user_id}:${l.key}`));
    const toSend = outbox.filter((o) => !alreadySent.has(`${o.userId}:${o.key}`));

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        note: "Intet er sendt eller logget — dette er kun en forhåndsvisning.",
        wouldSend: toSend.map(({ userId, key, title, body }) => ({ userId, key, title, body })),
      });
    }
    if (!toSend.length) return res.status(200).json({ sent: 0, note: "Alt er allerede sendt" });

    // ---- send + log + ryd døde abonnementer op ----
    let sent = 0;
    const deadSubIds = new Set();
    for (const msg of toSend) {
      const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag, url: "/" });
      for (const s of subsByUser[msg.userId] || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) deadSubIds.add(s.id); // enheden er afmeldt
        }
      }
    }
    await sb(`/rest/v1/notification_log?on_conflict=user_id,key`, {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: JSON.stringify(toSend.map((o) => ({ user_id: o.userId, key: o.key }))),
    });
    if (deadSubIds.size) {
      await sb(`/rest/v1/push_subscriptions?id=in.(${[...deadSubIds].join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    }

    res.status(200).json({ sent, messages: toSend.length, removedSubscriptions: deadSubIds.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
