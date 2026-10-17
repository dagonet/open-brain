# @open-brain/cli

The `brain` command: capture thoughts from a shell, import notes, export to Obsidian, compile wiki pages and audit contradictions. It is not published to npm; build it from a clone.

```bash
npm ci --prefix cli
npm run build --prefix cli
npm install -g --install-links=false ./cli       # from the repo root (PowerShell: .\cli)
export BRAIN_API_URL="https://<project-ref>.supabase.co"
export BRAIN_SERVICE_KEY="<service-role-key>"    # the legacy service_role JWT
brain "your thought here"
```

After every `git pull`, rebuild: `brain` runs the compiled `cli/dist/`. Node.js 18+ runs it; building and testing needs 22.12+.

The full reference (configuration, every command and flag, error messages) is in [`docs/cli.md`](../docs/cli.md). Symptoms and fixes: [`docs/troubleshooting.md`](../docs/troubleshooting.md).
