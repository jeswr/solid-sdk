<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Tasks comments

Commenting requires edit access to the project; a Commenter role is out of scope.
Tasks sharing supports Viewer and Editor grants, with owners retaining control.
Comments inherit the project stateStore's permissions through its `comments/`
container, so they need no per-resource ACLs or append-only path. The UI offers
edit and delete for the signed-in author's comments. The pod enforces project
access, and denied writes show the existing permission error.

Root deletion conditionally replaces the body with `[Comment deleted]`. Empty
tombstoned threads are hidden; replies retain their anchor, including replies
created concurrently with deletion. Reply resources can be deleted outright.

Task moves copy comments and replies with remapped targets before deleting the
source task, then conditionally remove the source comments. Project deletion
empties the comments container before removing the project stateStore.
