import { request } from "@/lib/auth";

export const acceptInvitation = (token) => request("/v1/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
