# ChainLetter CLVerify.js Integration Guide

`clverify.js` is a lightweight, zero-dependency verification widget for the ChainLetter ecosystem. It allows you to transform static IPFS links into interactive, cryptographically-verifiable trust badges.

---

##  Quick Start

Include the script on your page. It will automatically scan for targets when the DOM is ready.

```html
<script src="https://verify.clstamp.com/widget/clverify.js"></script>
```

---

##  Usage Patterns

### 1. Verification Button (`<clverify>`)

The most common usage. It replaces the tag with a "Verify" button that opens a comprehensive verification modal.

```html
<clverify cid="QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"></clverify>
```

### 2. Enhanced Anchor Tags (`<a>`)

Transform any standard link into a verification trigger by adding the `cid` attribute. The script intercepts the click to open the modal.

```html
<a cid="QmXoyp...uco" logo>Verifiable Link</a>
```

- **`logo`**: (Boolean) Optional. Prepends a small ChainLetter glyph icon to the link text and applies inline styling.

---

## ⚙️ Configuration Attributes

You can apply these attributes to both `<clverify>` and `<a>` tags for granular control:

| Attribute            | Description                                                                                                                                                                                                                         | Default                                    |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| **`cid`**            | **Required**. The IPFS Content Identifier to verify.                                                                                                                                                                                | -                                          |
| **`gateway`**        | Override the IPFS gateway for content preview.                                                                                                                                                                                      | `https://chainletter.mypinata.cloud/ipfs/` |
| **`api`**            | Backend host to fetch verification reports from.                                                                                                                                                                                    | (Script Host)                              |
| **`mode`**           | UI Theme: `light`, `dark`, or `auto`.                                                                                                                                                                                               | `auto`                                     |
| **`privatesrc`**     | Fallback direct URL if IPFS is not accessible.                                                                                                                                                                                      | -                                          |
| **`previewsrc`**     | URL for a static preview image (shown while loading).                                                                                                                                                                               | -                                          |
| **`global`**         | `"true"`: Skip "Issued By" / "Stamped as Part of a Group" and confirm only that the file exists in DB, blockchain, and IPFS. `"false"`: Show and require that the file was issued by the current domain for "Blockchain Confirmed". | `"false"`                                  |
| **`explorer`**       | Base URL for blockchain transaction links.                                                                                                                                                                                          | `https://sepolia.basescan.org/tx/`         |
| **`explorersuffix`** | Suffix for explorer links (e.g., `#eventlog`).                                                                                                                                                                                      | `#eventlog`                                |

---

##  Local vs. Global Verification

The `global` attribute controls whether the widget shows domain-specific issuance and what counts as "confirmed":

- **Local Mode (`global="false"`, default)**: The widget shows "Issued By" and "Stamped as Part of a Group" rows and does a reverse lookup against the current domain. "Blockchain Confirmed" is only shown when the file was issued by the domain currently hosting the widget; otherwise it shows a caution that the file was not issued by this domain.
- **Global Mode (`global="true"`)**: The widget skips the "Issued By" and "Stamped as Part of a Group" rows. "Fully verified" is based only on the file existing in the ChainLetter database, on the Base blockchain, and on IPFS—with no check that the current domain issued it. Use this for cross-domain or public assets.

---

##  Global Configuration

You can set project-wide defaults by adding data-attributes to the main `<script>` tag:

```html
<script
  src="..."
  data-explorer="https://basescan.org/tx/"
  data-explorersuffix="#events"></script>
```

---

##  Imperative API

For dynamic applications (like Next.js or React), you can interact with the widget via the `window.CLVerify` object:

### `CLVerify.scan(root)`

Manually triggers a scan of the DOM. Useful after adding dynamic content.

```javascript
CLVerify.scan(document.getElementById("new-content"));
```

### `CLVerify.setExplorer(base, suffix)`

Update the blockchain explorer settings at runtime for all widgets.

```javascript
CLVerify.setExplorer("https://etherscan.io/tx/", "");
```

---

##  Advanced: Replacement Gateway Logic

If a file exists on a private server but you want to provide a "Verifiable" version, use the `privatesrc` attribute along with a `gateway` override.

```html
<clverify
  cid="Qm..."
  gateway="https://my-local-ipfs-gateway.com/ipfs/"
  privatesrc="https://my-secure-server.com/files/document.pdf"></clverify>
```

The widget will first attempt to load the file via the **gateway**. If it fails (404 or Timeout), it will fallback to the **privatesrc** while still maintaining the cryptographic proof of the original CID.
