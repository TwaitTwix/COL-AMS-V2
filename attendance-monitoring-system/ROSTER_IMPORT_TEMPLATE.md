# Preparing an official class-list workbook

Open **Class lists → Open class → Download Excel template** in the revised workspace. Use that class's official institution/course/year/term, and upload only the list you are authorized to maintain.

1. Keep one visible worksheet and the two headers in row 1: **School ID** and **Full name**.
2. Enter IDs as **text**, especially IDs such as `00012345`. The template's ID column is already formatted as text. Changing a previously numeric cell's format cannot recover zeroes that Excel already removed; re-enter the original ID from the official source.
3. Use one student per row, up to 1000 student rows per upload. Save as `.xlsx`, no larger than 2 MB.
4. Use plain names and text IDs. IDs support letters, numbers, spaces, periods, slashes, underscores and hyphens, with a letter/number first and at most 40 characters. Letter case is normalized. Names support up to 120 characters; formula prefixes/control characters are rejected.
5. Keep other columns, sheets, merged cells, images, macros, formulas, hyperlinks and embedded files out of the import workbook. Copy the required values into the template if the school's original workbook contains additional information.

Choose **Merge** for routine additions: omitted students stay in the next list. Choose **Replace** for a complete reviewed replacement: omitted students leave the next version, while all previous lists and attendance remain preserved.

After **Validate and preview**, review every rejected row. Duplicate IDs, numeric IDs, archived identities and conflicting names/known institutions require correction or authorized identity review. Merge can save an explicitly accepted valid subset. Replace requires every row to be valid and an explicit confirmation of removals.

Enter the reason and choose **Save reviewed list**. A saved list has a version number and can be reused for several events. Event class-list selection freezes a specific version; uploading a newer list does not silently change an event's saved eligibility.
