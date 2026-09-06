# Wallet Identity & SIWE Specification

## 1. Overview & Objectives

AgentMesh uses **Sign-In with Ethereum (SIWE / EIP-4361)** for wallet-based authentication.

By connecting an Ethereum wallet and signing a cryptographically secure SIWE message, users establish control over their Ethereum address without relying on traditional passwords or third-party OAuth providers.

> [!IMPORTANT]
> **Identity Scope Note**: Wallet authentication establishes control of the Ethereum address. It does not yet establish ownership of an AgentMesh agent through an on-chain relationship.

---

## 2. Authentication Flow

```text
  User / Browser               AgentMesh Server               Ethereum Wallet
       │                              │                              │
       ├──── 1. GET /auth/nonce ─────►│                              │
       │◄─── 2. { nonce } ────────────┤                              │
       │                              │                              │
       ├──── 3. Construct SIWE Message ─────────────────────────────►│
       │◄─── 4. Sign Message (personal_sign) ────────────────────────┤
       │                              │                              │
       ├──── 5. POST /auth/verify ───►│                              │
       │     { message, signature }   │                              │
       │                              ├─ Validate EIP-4361 Message    │
       │                              ├─ Verify Cryptographic Sig    │
       │                              ├─ Validate Domain/URI/Chain   │
       │                              ├─ Consume Single-Use Nonce    │
       │                              ├─ Normalize Wallet Address    │
       │                              ├─ Find or Create User         │
       │                              └─ Create AuthSession          │
       │◄─── 6. HTTP-Only Cookie ─────┤                              │
       │     + User Object Response   │                              │
```

1. **Nonce Request**: Frontend calls `GET /auth/nonce` to obtain a short-lived, single-use cryptographically secure nonce.
2. **SIWE Message Construction**: Frontend formats an EIP-4361 SIWE message containing the domain, wallet address, URI, chain ID, nonce, and timestamp.
3. **Wallet Signature**: User signs the message using their Ethereum wallet (`personal_sign`).
4. **Signature Verification**: Frontend posts `{ message, signature }` to `POST /auth/verify`.
5. **Session Issuance**: Upon successful verification, the server creates/links a `User` record with lowercased normalized `walletAddress`, stores an `AuthSession` in PostgreSQL, and sets an HTTP-only `agentmesh_session` cookie.

---

## 3. Environment Variables & Configuration

Configure SIWE parameters in `.env`:

```env
# SIWE & Authentication Configuration
SIWE_DOMAIN=localhost
SIWE_URI=http://localhost:5173
SIWE_CHAIN_ID=11155111
SESSION_MAX_AGE_MS=86400000
```

| Variable             | Description                                      | Default                 |
| :------------------- | :----------------------------------------------- | :---------------------- |
| `SIWE_DOMAIN`        | Expected RFC 3986 authority domain               | `localhost`             |
| `SIWE_URI`           | Expected RFC 3986 URI issuing the request        | `http://localhost:5173` |
| `SIWE_CHAIN_ID`      | EIP-155 Chain ID (`11155111` for Sepolia)        | `11155111`              |
| `SESSION_MAX_AGE_MS` | Session cookie validity duration in milliseconds | `86400000` (24h)        |

---

## 4. API Endpoints

### `GET /auth/nonce`

- **Auth**: Public
- **Response**: `200 OK`
  ```json
  { "nonce": "cryptographic-random-nonce" }
  ```

### `POST /auth/verify`

- **Auth**: Public
- **Body**:
  ```json
  {
    "message": "SIWE EIP-4361 message string",
    "signature": "0x..."
  }
  ```
- **Response**: `200 OK` (Sets HTTP-only `agentmesh_session` cookie)
  ```json
  {
    "user": {
      "id": "cuid",
      "walletAddress": "0x71c7656ec7ab88b098defb751b7401b5f6d8976f",
      "displayName": null
    }
  }
  ```

### `GET /auth/me`

- **Auth**: Required (`agentmesh_session` cookie or `Authorization: Bearer <sessionId>`)
- **Response**: `200 OK`
  ```json
  {
    "user": {
      "id": "cuid",
      "walletAddress": "0x71c7656ec7ab88b098defb751b7401b5f6d8976f",
      "displayName": null
    }
  }
  ```

### `POST /auth/logout`

- **Auth**: Optional
- **Response**: `204 No Content` (Clears session cookie and invalidates database `AuthSession`)

---

## 5. Security Model

1. **Single-Use Nonce**: Nonces are stored in PostgreSQL (`SiweNonce`) and immediately deleted upon verification attempt, mitigating replay attacks.
2. **Server-Side Verification**: Signatures are verified using `siwe` and `viem` libraries. Client-supplied user IDs are never trusted.
3. **Session-Derived Operations**: Authenticated operations (e.g., project creation) derive the actor's `userId` from the verified session context (`req.auth.userId`).
4. **HTTP-Only Cookies**: Session tokens are stored in `HttpOnly`, `SameSite=Lax` cookies to protect against XSS token extraction.
