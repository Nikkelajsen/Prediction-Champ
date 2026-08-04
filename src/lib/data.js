// Data-laget: alle asynkrone loaders og mutationer mod Supabase.
//
// Filen var 761 linjer og udpeget som teknisk gæld i DOCUMENTATION.md afsnit 12.
// Den er nu delt i tematiske moduler under data/ og står tilbage som en ren
// re-eksport, så ingen af de 12 importsteder i src/ behøvede at ændre sig.
//
// At barrel'en beholder præcis samme offentlige flade er selve pointen: en
// tabt eksport bliver en byggefejl, ikke en fejl i produktion. Skal du tilføje
// noget nyt, så læg det i det modul, det hører til — ikke her.

export { touchActivity, loadUserStats, loadLatestStory, loadRoundCarousel, loadRecentMilestones, dismissStory } from "./data/activity.js";
export { ensureCompetitionAwards, loadCompetitionAwards } from "./data/awards.js";
export { loadCareerProfile, loadCareerMilestones } from "./data/career.js";
export { computeCompetitionState } from "./data/competitionState.js";
export { moveCompetitionToGroup, createCompetition, joinByInviteCode, inviteCodeFrom } from "./data/competitions.js";
export { loadMyGroups, loadGroupDetail, loadGroupByCode, createGroup, joinGroup, leaveGroup, deleteGroup, joinCompetition, leaveCompetition } from "./data/groups.js";
export { computeHomeTips, computeCurrentRound, daFullDate, fmtCountdown, monthName } from "./data/home.js";
export { loadRatingBoard, loadRatingMap, loadRatingHistory, currentMonthKey, loadMonthlyBoard, loadMonthsAvailable, loadRoundsAvailable, loadRoundBoard, loadSeasonBoard } from "./data/standings.js";
