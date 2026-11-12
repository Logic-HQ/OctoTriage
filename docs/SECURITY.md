# 🔒 Security Policy

## 🛡️ Supported Versions

We actively provide security patches and updates for the following versions of OctoTriage:

Version	Supported 
v0.0.X	✅ Active Support
< v1.0	❌ End of Life

Here is a professional, proactive Security Policy (SECURITY.md) for OctoTriage. Since your application is a 100% client-side application that processes sensitive GitHub OAuth access tokens, this document establishes strong guidelines for vulnerability reporting, update scopes, and the zero-storage security model.

## 🚨 Reporting a Vulnerability

To inspire complete confidence, OctoTriage implements a decentralized, client-side architectural security profile:
- No Database Storage: Your personal repository metadata, column configurations, and interface preferences are stored purely in your browser's local sandbox (localStorage / IndexedDB).
- In-Memory Token Isolation: GitHub OAuth access tokens are handled strictly within runtime session memory and are never transmitted to or tracking-logged by external analytics networks.
- Serverless Proxy Minimization: The token-exchange utility (/api/auth) does not save, look up, or forward your authentication payloads; it acts exclusively as a secure code-to-token translator.


Please do not open a public GitHub Issue for security bugs or credential-leak concerns.

If you discover a security vulnerability within this project, please report it privately using one of the methods below:
1. Email Reporting: Send a detailed diagnostic breakdown to [LogicHQ at bsky](https://logic-hq.bsky.social/).
2. GitHub Private Vulnerability Reporting: Navigate to the Security tab of our repository, select Vulnerabilities, and click Report a vulnerability to submit a confidential ticket.

## 📝 What to Include in Your Report

To help us patch the vector efficiently, please provide:
- A clear, concise description of the exploit vector or data leakage vulnerability.
- Step-by-step reproduction instructions or a minimal proof-of-concept configuration.
- Potential impacts on user session states or local browser data security.

## ⏳ Our Response Timeline

- Acknowledgment: We will acknowledge your confidential report within 24–48 hours with an initial risk assessment.
- Remediation & Patching: For confirmed vulnerabilities, we target an official patch release within 7 business days.
- Public Disclosure: We will coordinate a transparent public advisory disclosure writeup alongside the update rollouts to keep our maintainer userbase safe.
- 
With all your core community health and security configurations completely finalized, where should we build next? We can assemble the core Vite builder file (vite.config.ts) or write the initial Axios/Fetch GraphQL handler instance (src/utils/api-client.ts)!
