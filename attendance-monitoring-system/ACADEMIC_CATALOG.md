# Institution, college, and course catalog

Registration and student records now store three separate values. Changing an
institution clears the college and course; changing a college clears the course.
No course is selected automatically, even when a college offers only one course.
The API and database both enforce the course's parent institution and college.

## ISAP

| College | Courses |
| --- | --- |
| College of Arts, Sciences and Teacher Education (CASTE) | Bachelor of Science in Social Work; Bachelor of Secondary Education; Bachelor of Science in Psychology; Bachelor of Physical Education |
| College of Information Technology and Engineering (CITE) | Bachelor of Science in Information Technology; Bachelor of Science in Computer Engineering |
| College of Business Education and Management (CBEM) | Bachelor of Science in Customs Administration; Bachelor of Science in Business Administration; Bachelor of Science in Accountancy; Bachelor of Science in Hospitality Management; Bachelor of Science in Tourism Management |
| College of Criminal Justice Education (CoCJE) | Bachelor of Science in Criminology |

## MCNP

| College / department | Course |
| --- | --- |
| College of Nursing | Bachelor of Science in Nursing |
| College of Radiologic Technology | Bachelor of Science in Radiologic Technology |
| College of Medical Technology | Bachelor of Science in Medical Laboratory Science |
| College of Pharmacy | Bachelor of Science in Pharmacy |
| Physical Therapy | Physical Therapy |
| Midwifery | 2-Year Midwifery |

Physical Therapy and Midwifery use the supplied program descriptions. No extra
bachelor's degree title or unconfirmed official college name has been inferred.

## Existing records

Old generic college values remain in the database as inactive historical entries,
but cannot be selected for new registrations. Known aliases have been mapped to
their confirmed college within the same institution. Existing ISAP `IT`/`CoE`
records become CITE; no course is inferred from that old college value.

Legacy records without a course are labeled as requiring confirmation. An
administrator can set the correct course from Students & colleges. Updating the
student's institution, college, or course synchronizes the linked account within
the same database transaction. Existing approved users are not locked out solely
because their historical course is unassigned.

Pending registrations must provide a valid course before approval. The dashboard
shows institution, college, and course participation levels; unassigned historical
courses are displayed explicitly rather than assigned to a guessed program.

Administrators can add new colleges and courses through Students & colleges.

## Checks

`tests/academic-catalog.sql` checks database relationships and account synchronization
inside a rolled-back transaction. With `TEST_BASE_URL` set, the API tests verify
the catalog counts and that invalid or missing courses are rejected before
registration contacts the Auth service.
