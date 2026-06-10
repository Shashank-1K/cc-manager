$env:CLAUDE_PROFILES_ROOT = $PSScriptRoot
node "$PSScriptRoot\dashboard\server.js" @args
