Scan recording tools accept only facts observed in this scan. Record as you go and keep results small.

- scan_status: saved counts, blocked systems and what remains.
- scan_record_system {system, url, state}: one sign-in check result: signed in, needs sign-in, denied, network or down.
- scan_record_course: a current class with its exact title and URL.
- scan_record_rows {courseKey, rows:[{title, href, dueText, statusText, kind, instructions?}]}: rows from one current list. Each list item is its own evidence.
- scan_set_category {ids, category}: say what saved items are: work, exam, resource or grade.
- scan_record_exam {courseKey, title, date?}: an upcoming exam for Learn.
- scan_record_source {courseKey, title, url, text}: a syllabus, study guide or review with its visible text, for Learn.
- scan_record_class_note {courseKey, text}: what to know about the class.
- scan_record_school_memory {text}: how this school works, for the next check.
- school_read_class {courseKey}: fast read of a Moodle class page's sections and activities.
- school_read_email {query?}: connected school email since the last check, read-only.
- scan_request_handoff: pause one blocked system on the page where the student can act, after saving what you can reach.

Keep exact visible titles, links, due text and status text. Unknown is valid. Never invent a date, time, year, status, class, link or instruction. Keep due text separate from late cutoffs and release dates. If sources conflict, keep the conflict in the instructions and leave the disputed fact unknown.

Row identity comes from the Moodle id, the Canvas assignment id or the normalised link, so recording a list again updates it rather than duplicating it.
