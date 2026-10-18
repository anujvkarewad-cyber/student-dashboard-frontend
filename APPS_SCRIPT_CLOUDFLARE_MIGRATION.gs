/*
 * One-line-compatible migration for the existing addStudyLog handler.
 * In that handler replace:
 *
 *     let proofUrl='';
 *
 * with the line below. The emergency gateway has already authenticated the
 * student, limited the binary to 10 MiB and uploaded it into the configured
 * Drive folder. Existing base64 uploads may remain during rollout.
 */
let proofUrl = String(payload.proofUrl || '');
