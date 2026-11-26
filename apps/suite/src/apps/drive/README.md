<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Drive offers **Open with Sheets** for CSV filenames and `text/csv` files in the item
menu and preview. It creates a separate workbook through Sheets’ CSV importer,
using the filename without `.csv` as its title, and leaves the source untouched.
Downloads stay within the active pod, refuse redirects and stop at 50 MB. Offline,
read and Sheets folder Write failures use the same menu hints and toast pattern as Docs.

A direct child of the pod’s `sheets/` root with readable Sheets metadata, at least
one sheet and an existing `workbook.json` appears as one **Spreadsheet**, with its
metadata title and table icon. It opens in Sheets. A similarly named ordinary
folder stays a folder. Trash and deletion use Drive’s recursive container operations.
Rename and move are hidden (including keyboard and drag actions): renaming a folder
would leave the metadata title unchanged, and moving it can leave the editor’s scope.
Use Sheets to rename the workbook title.
Restore retains the trash copy if its original workbook slug is occupied, avoiding
broken absolute RDF links or changes to the occupying workbook.
