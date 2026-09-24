Scan recording tools accept only facts observed in the current scan. Record discoveries immediately and keep tool results small.

- scan_status: read saved counts, blocked systems, and the remaining checklist before choosing the next target.
- scan_record_system {system, url, state}: save one preflight result. State is signed in, needs sign-in, denied, network, or down.
- scan_record_course: save an observed current course with its stable key, exact title, URL, and system.
- scan_record_rows {courseKey, rows:[{title, href, dueText, statusText, kind, instructions?}]}: save compact rows from one current list. Each list item is its own evidence.
- scan_record_source: save a syllabus or study-guide URL with its observed text for Learn.
- scan_request_handoff: pause one blocked system on the exact page where the student can act; continue reachable work first.

Keep exact visible titles, destination links, due text, and status text. Unknown or absent is valid. Never invent a date, time, year, status, course, link, or instruction. Keep due text separate from late cutoffs, release dates, and status. If current sources conflict, preserve the conflict in instructions and leave the disputed fact unknown.

For refresh, row identity comes from the Moodle cmid, Canvas assignment id, or normalized destination URL. Record complete current lists so the app can detect new, changed-date, changed-status, and removed rows. Do not revisit unchanged detail pages.

For details, instructions must come from the target assignment or its directly linked material. For materials, record only sources belonging to the target class. A failed, inaccessible, or unreadable source remains unchecked and must be reported; it is never permission to guess.
