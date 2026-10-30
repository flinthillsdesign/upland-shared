import { test } from "node:test";
import assert from "node:assert";
import { AVATAR_COLORS, avatarColor, avatarFor, avatarHtml, avatarInitials } from "../src/avatar";

test("initials: first and last word, one word, email, nothing", () => {
  assert.equal(avatarInitials("Joel Gaeddert"), "JG");
  assert.equal(avatarInitials("Anna Lookabill Scott"), "AS");
  assert.equal(avatarInitials("  Dave "), "DA");
  assert.equal(avatarInitials("", "anthony.esau@uplandexhibits.com"), "AE");
  assert.equal(avatarInitials(null, "joel@uplandexhibits.com"), "JO");
  assert.equal(avatarInitials(null, null), "·");
});

test("color: stable per key and always from the palette", () => {
  assert.equal(avatarColor("u_123"), avatarColor("u_123"));
  assert.ok((AVATAR_COLORS as readonly string[]).includes(avatarColor("anything")));
  // Pinned so a palette or hash edit is a deliberate change.
  assert.equal(avatarColor("u_123"), "#8c5f5f");
  assert.equal(avatarColor("Joel Gaeddert"), "#4f9a8a");
});

test("avatarFor: a data URI is the image; anything else means initials", () => {
  const img = "data:image/webp;base64,AAAA";
  assert.equal(avatarFor({ id: "u1", name: "Joel Gaeddert", avatar: img }).image, img);
  assert.equal(avatarFor({ id: "u1", name: "Joel Gaeddert", avatar: "https://x/y.png" }).image, null);
  const a = avatarFor({ name: "Joel Gaeddert" });
  assert.equal(a.initials, "JG");
  assert.equal(a.label, "Joel Gaeddert");
  // The id keys the color when there is one; the name otherwise.
  assert.equal(avatarFor({ id: "u_123", name: "X" }).color, avatarColor("u_123"));
  assert.equal(avatarFor({ name: "Joel Gaeddert" }).color, avatarColor("Joel Gaeddert"));
});

test("avatarHtml: initials on the color, or the photo; escaped; options", () => {
  const plain = avatarHtml({ id: "u_123", name: 'Joel "JG" <G>' });
  assert.match(plain, /^<span class="avatar" style="--avatar-size:2rem;background:#8c5f5f" title="Joel &quot;JG&quot; &lt;G&gt;">J&lt;<\/span>$/);
  const img = avatarHtml({ id: "u1", name: "Joel", avatar: "data:image/webp;base64,AAAA" }, { size: "32px", cls: "td-ini", tag: "button", attrs: 'id="mebtn"' });
  assert.equal(img, '<button class="avatar td-ini" style="--avatar-size:32px" title="Joel" id="mebtn"><img src="data:image/webp;base64,AAAA" alt="" draggable="false"></button>');
  assert.equal(avatarHtml({ name: "Joel" }, { plain: true, title: false }), '<span class="avatar" style="--avatar-size:2rem">JO</span>');
  assert.equal(avatarHtml(null), '<span class="avatar" style="--avatar-size:2rem;background:#4f9a8a">·</span>');
});
