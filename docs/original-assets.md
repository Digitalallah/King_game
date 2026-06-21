# Original DOS assets

The repository must not include binary files from the original DOS game or PNG files extracted from them.

Place any local, untracked copies under `assets/original/` when you need to run asset extraction or compare against the original game. This path is intentionally ignored by Git and should only be referenced from documentation or scripts.

Expected local-only layout example:

```text
assets/original/
  KING.EXE
  KING.FNT
  KING.LIB
  KING2.EXE
  extracted/
    ... generated PNG files ...
```

Keep pull requests limited to text files such as source code, README/docs, and extraction scripts.
