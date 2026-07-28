"use client";

import { FormEvent, useState } from "react";
import type {
  AccessInvitation,
  TeamAccessView,
  TeamMember,
} from "@/server/team-access";
import type { AppDevice } from "@/server/devices";

type Props = {
  initialTeam: TeamAccessView;
  initialDevices: AppDevice[];
};

type ApiError = {
  error?: { message?: string };
};

const joinedDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

const seenDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function roleLabel(role: TeamMember["role"] | AccessInvitation["role"]) {
  if (role === "BUSINESS_OWNER") return "Business owner";
  if (role === "TRUSTED_OPERATOR") return "Trusted operator";
  return "Store operator";
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ApiError;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "The request could not be completed.");
  }
  return body;
}

async function copySignInLink() {
  await navigator.clipboard.writeText(`${window.location.origin}/sign-in`);
}

export default function TeamWorkspace({ initialTeam, initialDevices }: Props) {
  const [members, setMembers] = useState(initialTeam.members);
  const [invitations, setInvitations] = useState(initialTeam.invitations);
  const [devices, setDevices] = useState(initialDevices);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AccessInvitation["role"]>("STORE_OPERATOR");
  const [busyId, setBusyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function invite(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const body = await responseBody<{ invitation: AccessInvitation }>(
        await fetch("/api/v1/team", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, displayName, role }),
        }),
      );
      setInvitations((current) => [body.invitation, ...current]);
      setEmail("");
      setDisplayName("");
      setRole("STORE_OPERATOR");
      setMessage(
        body.invitation.deliveryStatus === "SENT"
          ? `Invitation sent to ${body.invitation.email}.`
          : `${body.invitation.email} is pre-approved. Email delivery needs attention.`,
      );
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Invitation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function invitationAction(
    invitation: AccessInvitation,
    action: "RESEND" | "REVOKE",
  ) {
    setBusyId(invitation.id);
    setMessage("");
    setError("");
    try {
      const body = await responseBody<{
        invitation?: AccessInvitation;
        revoked?: boolean;
      }>(
        await fetch(`/api/v1/team/invitations/${invitation.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      if (action === "REVOKE") {
        setInvitations((current) =>
          current.filter((item) => item.id !== invitation.id)
        );
        setMessage(`Invitation for ${invitation.email} revoked.`);
      } else if (body.invitation) {
        setInvitations((current) =>
          current.map((item) =>
            item.id === invitation.id ? body.invitation! : item
          )
        );
        setMessage(`Invitation email sent again to ${invitation.email}.`);
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Action failed.");
    } finally {
      setBusyId("");
    }
  }

  async function updateMember(
    member: TeamMember,
    next: { role: string; status: string },
  ) {
    setBusyId(member.id);
    setMessage("");
    setError("");
    try {
      const body = await responseBody<{ member: TeamMember }>(
        await fetch(`/api/v1/team/members/${member.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        }),
      );
      setMembers((current) =>
        current.map((item) => item.id === member.id ? body.member : item)
      );
      setMessage(`${body.member.displayName}'s access was updated.`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  async function updateDevice(
    device: AppDevice,
    action: "APPROVE" | "REVOKE",
  ) {
    setBusyId(device.deviceId);
    setMessage("");
    setError("");
    try {
      const body = await responseBody<{ device: AppDevice }>(
        await fetch(`/api/v1/devices/${device.deviceId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      setDevices((current) =>
        current.map((item) =>
          item.deviceId === device.deviceId ? body.device : item
        )
      );
      setMessage(
        action === "APPROVE"
          ? `${device.displayName} approved for ${device.userDisplayName}.`
          : `${device.displayName} revoked.`,
      );
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Device update failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="sell-page team-page" aria-labelledby="team-access-heading">
      <div className="page-heading">
        <p className="eyebrow">Owner control</p>
        <h1 id="team-access-heading">Team &amp; Access</h1>
        <p>
          Invite the exact Google email a person will use. Their account activates
          automatically after the invitation is accepted and they sign in.
        </p>
      </div>

      {(message || error) && (
        <div className={error ? "team-notice error" : "team-notice"} role="status">
          {error || message}
        </div>
      )}

      <section className="team-section invite-panel" aria-labelledby="invite-heading">
        <div className="team-section-heading">
          <div>
            <p className="eyebrow">New access</p>
            <h2 id="invite-heading">Invite a team member</h2>
          </div>
          <span>Owner only</span>
        </div>
        <form className="team-invite-form" onSubmit={invite}>
          <label>
            Google email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
              required
            />
          </label>
          <label>
            Name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
              maxLength={120}
            />
          </label>
          <label>
            Access level
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as AccessInvitation["role"])
              }
            >
              <option value="STORE_OPERATOR">Store operator</option>
              <option value="TRUSTED_OPERATOR">Trusted operator</option>
            </select>
          </label>
          <button className="button" disabled={submitting}>
            {submitting ? "Sending…" : "Send invitation"}
          </button>
        </form>
        <div className="role-explainer">
          <span>
            <strong>Store operator</strong>
            Sell within the configured price limits and view stock.
          </span>
          <span>
            <strong>Trusted operator</strong>
            Store access plus receiving stock and wider operational actions.
          </span>
        </div>
      </section>

      {invitations.length > 0 && (
        <section className="team-section" aria-labelledby="pending-heading">
          <div className="team-section-heading">
            <div>
              <p className="eyebrow">Waiting</p>
              <h2 id="pending-heading">Pending invitations</h2>
            </div>
            <span>{invitations.length}</span>
          </div>
          <div className="team-list">
            {invitations.map((invitation) => (
              <article className="team-row" key={invitation.id}>
                <div className="team-person">
                  <strong>{invitation.displayName || invitation.email}</strong>
                  <small>{invitation.email}</small>
                  <small>
                    {roleLabel(invitation.role)} · invited{" "}
                    {joinedDate.format(new Date(invitation.createdAt))}
                  </small>
                </div>
                <span
                  className={
                    invitation.deliveryStatus === "SENT"
                      ? "access-pill active"
                      : "access-pill waiting"
                  }
                >
                  {invitation.deliveryStatus === "SENT"
                    ? "Email sent"
                    : "Email needs attention"}
                </span>
                <div className="team-actions">
                  <button
                    type="button"
                    onClick={() => {
                      copySignInLink()
                        .then(() => setMessage("Sign-in link copied."))
                        .catch(() => setError("Could not copy the sign-in link."));
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    disabled={busyId === invitation.id}
                    onClick={() => invitationAction(invitation, "RESEND")}
                  >
                    Send again
                  </button>
                  <button
                    className="danger-link"
                    type="button"
                    disabled={busyId === invitation.id}
                    onClick={() => invitationAction(invitation, "REVOKE")}
                  >
                    Revoke
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="team-section" aria-labelledby="members-heading">
        <div className="team-section-heading">
          <div>
            <p className="eyebrow">Current access</p>
            <h2 id="members-heading">Team members</h2>
          </div>
          <span>{members.filter((member) => member.status === "ACTIVE").length} active</span>
        </div>
        <div className="team-list">
          {members.map((member) => {
            const isOwner = member.role === "BUSINESS_OWNER";
            return (
              <article className="team-row" key={member.id}>
                <div className="team-person">
                  <strong>{member.displayName}</strong>
                  <small>{member.email || "Email will appear after next sign-in"}</small>
                  <small>Joined {joinedDate.format(new Date(member.createdAt))}</small>
                </div>
                {isOwner ? (
                  <span className="access-pill owner">Business owner</span>
                ) : (
                  <label className="inline-access-field">
                    <span>Role</span>
                    <select
                      value={member.role}
                      disabled={busyId === member.id}
                      onChange={(event) =>
                        updateMember(member, {
                          role: event.target.value,
                          status: member.status,
                        })
                      }
                    >
                      <option value="STORE_OPERATOR">Store operator</option>
                      <option value="TRUSTED_OPERATOR">Trusted operator</option>
                    </select>
                  </label>
                )}
                <div className="team-actions">
                  {isOwner ? (
                    <span className="owner-protected">Protected account</span>
                  ) : (
                    <button
                      type="button"
                      className={member.status === "ACTIVE" ? "danger-link" : ""}
                      disabled={busyId === member.id}
                      onClick={() =>
                        updateMember(member, {
                          role: member.role,
                          status: member.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                        })
                      }
                    >
                      {member.status === "ACTIVE" ? "Disable access" : "Restore access"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="team-section" aria-labelledby="devices-heading">
        <div className="team-section-heading">
          <div>
            <p className="eyebrow">Offline control</p>
            <h2 id="devices-heading">Enrolled devices</h2>
          </div>
          <span>{devices.filter((device) => device.status === "ACTIVE").length} active</span>
        </div>
        <p className="device-section-note">
          Approving a device prepares it for bounded offline use. Online access
          continues to follow the team member’s account status and role.
        </p>
        {devices.length ? (
          <div className="team-list">
            {devices.map((device) => (
              <article className="team-row" key={device.deviceId}>
                <div className="team-person">
                  <strong>{device.displayName}</strong>
                  <small>
                    {device.userDisplayName} · {roleLabel(device.userRole)}
                  </small>
                  <small>
                    Last seen {seenDate.format(new Date(device.lastSeenAt))}
                  </small>
                </div>
                <span className={`access-pill ${device.status.toLowerCase()}`}>
                  {device.status === "ACTIVE"
                    ? "Approved"
                    : device.status === "PENDING"
                      ? "Approval needed"
                      : "Revoked"}
                </span>
                <div className="team-actions">
                  {device.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={busyId === device.deviceId}
                      onClick={() => updateDevice(device, "APPROVE")}
                    >
                      Approve device
                    </button>
                  )}
                  {device.status !== "REVOKED" && (
                    <button
                      type="button"
                      className="danger-link"
                      disabled={busyId === device.deviceId}
                      onClick={() => updateDevice(device, "REVOKE")}
                    >
                      Revoke
                    </button>
                  )}
                  {device.status === "REVOKED" && (
                    <span className="owner-protected">Use a new enrollment to restore</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="device-empty">
            Devices appear here after a team member opens the Sell screen online.
          </p>
        )}
      </section>
    </section>
  );
}
