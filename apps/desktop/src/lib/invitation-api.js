import { request } from "@/lib/auth";

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeInvitationCode(value) {
  let raw = String(value || "").trim().toUpperCase().replace(/^(?:.*#\/join\/|.*\/join\/)/, "").replace(/[-\s]/g, "");
  raw = raw.replaceAll("O", "0").replaceAll("I", "1").replaceAll("L", "1");
  if (raw.length !== 10 || [...raw].some((char) => !CODE_ALPHABET.includes(char))) return "";
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function parseInvitationInput(value) {
  const normalized = normalizeInvitationCode(value);
  return normalized || null;
}

export function buildInvitationUrl(code) {
  const normalized = normalizeInvitationCode(code);
  return normalized ? `${window.location.origin}/#/join/${normalized}` : "";
}

export const acceptInvitation = (code) => {
  const normalized = normalizeInvitationCode(code);
  if (!normalized) return Promise.reject(Object.assign(new Error("邀请短码无效"), { code: "invalid_invitation_code" }));
  return request("/v1/invitations/accept", { method: "POST", body: JSON.stringify({ code: normalized }) });
};
