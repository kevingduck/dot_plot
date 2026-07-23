#!/usr/bin/env node
// Operator escape hatch: reset an account's password from the server shell
// (e.g. Render → Shell) when reset email isn't configured.
//
//   node scanner/reset-password.mjs user@example.com newpassword123

import { adminSetPassword } from './auth.mjs'

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: node scanner/reset-password.mjs <email> <new password (8+ chars)>')
  process.exit(1)
}
try {
  console.log(`Password updated for ${adminSetPassword(email, password)}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
