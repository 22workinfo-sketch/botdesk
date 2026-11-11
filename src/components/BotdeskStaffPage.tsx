"use client";

import { useState, useEffect } from "react";
import { AdminSession } from "@/lib/auth";

interface StaffBot {
  id: string;
  name: string;
  username: string;
}

interface StaffAssignment {
  id: string;
  botId: string;
  canPublish: boolean;
  bot: StaffBot;
}

interface StaffMember {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "EDITOR" | "VIEWER";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  staffAssignments: StaffAssignment[];
}

export function BotdeskStaffPage({
  sessionUser,
}: {
  sessionUser: AdminSession;
}) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [availableBots, setAvailableBots] = useState<StaffBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Add Staff Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "EDITOR" | "VIEWER" | "SUPER_ADMIN">("EDITOR");
  const [newAssignedBotIds, setNewAssignedBotIds] = useState<string[]>([]);
  const [newCanPublish, setNewCanPublish] = useState(false);
  const [addingSubmitting, setAddingSubmitting] = useState(false);

  // Edit Staff Modal State
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editRole, setEditRole] = useState<"ADMIN" | "EDITOR" | "VIEWER" | "SUPER_ADMIN">("EDITOR");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editAssignedBotIds, setEditAssignedBotIds] = useState<string[]>([]);
  const [editCanPublish, setEditCanPublish] = useState(false);
  const [editResetPassword, setEditResetPassword] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/staff");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load staff accounts");
      }
      const data = await res.json();
      setStaffList(data.staff || []);
      setAvailableBots(data.allBots || []);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load staff list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleOpenAdd = () => {
    setNewEmail("");
    setNewPassword("");
    setNewRole("EDITOR");
    setNewAssignedBotIds(availableBots.length > 0 ? [availableBots[0].id] : []);
    setNewCanPublish(false);
    setErrorMessage(null);
    setShowAddModal(true);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (newPassword.length < 8) {
      setErrorMessage("Initial password must be at least 8 characters long.");
      return;
    }

    try {
      setAddingSubmitting(true);
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          initialPassword: newPassword,
          role: newRole,
          assignedBotIds: newRole === "SUPER_ADMIN" ? [] : newAssignedBotIds,
          canPublish: newRole === "ADMIN" ? true : newCanPublish,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create staff account.");
      }

      setSuccessMessage(`Account created for ${newEmail}. User will be required to change password on first login.`);
      setShowAddModal(false);
      fetchStaff();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create account.");
    } finally {
      setAddingSubmitting(false);
    }
  };

  const handleOpenEdit = (member: StaffMember) => {
    setEditingStaff(member);
    setEditRole(member.role);
    setEditIsActive(member.isActive);
    setEditAssignedBotIds(member.staffAssignments.map((a) => a.botId));
    setEditCanPublish(member.staffAssignments.some((a) => a.canPublish));
    setEditResetPassword("");
    setErrorMessage(null);
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      setEditSubmitting(true);
      const res = await fetch(`/api/staff/${editingStaff.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editRole,
          isActive: editIsActive,
          assignedBotIds: editRole === "SUPER_ADMIN" ? [] : editAssignedBotIds,
          canPublish: editRole === "ADMIN" ? true : editCanPublish,
          resetPassword: editResetPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update staff account.");
      }

      setSuccessMessage(`Account ${editingStaff.email} updated successfully.`);
      setEditingStaff(null);
      fetchStaff();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to update account.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteStaff = async (member: StaffMember) => {
    if (!confirm(`Are you sure you want to permanently delete account ${member.email}?`)) {
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      setDeletingId(member.id);
      const res = await fetch(`/api/staff/${member.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete staff account.");
      }
      setSuccessMessage(`Account ${member.email} deleted.`);
      fetchStaff();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to delete account.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Screen Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="botdesk-badge blue mb-2 inline-block">
            WORKSPACE MANAGEMENT
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Users & Access Control
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Manage backstage team accounts, role privileges, and bot assignments with least privilege.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="botdesk-btn primary text-xs py-2 px-4 font-semibold shrink-0"
        >
          ＋ Add Staff Account
        </button>
      </div>

      {/* Global Alerts */}
      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-[var(--redbg)] border border-[var(--red)] text-xs text-[var(--red)] flex items-center justify-between">
          <span>⚠️ {errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-bold hover:underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-400 flex items-center justify-between">
          <span>✓ {successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-bold hover:underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <span className="text-[var(--muted)] block">Total Staff</span>
          <strong className="text-lg font-bold text-[var(--text)]">{staffList.length}</strong>
        </div>
        <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <span className="text-[var(--muted)] block">Super Admins</span>
          <strong className="text-lg font-bold text-[var(--text)]">
            {staffList.filter((s) => s.role === "SUPER_ADMIN" && s.isActive).length}
          </strong>
        </div>
        <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <span className="text-[var(--muted)] block">Editors & Viewers</span>
          <strong className="text-lg font-bold text-[var(--text)]">
            {staffList.filter((s) => s.role === "EDITOR" || s.role === "VIEWER").length}
          </strong>
        </div>
        <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <span className="text-[var(--muted)] block">Active Accounts</span>
          <strong className="text-lg font-bold text-emerald-400">
            {staffList.filter((s) => s.isActive).length}
          </strong>
        </div>
      </div>

      {/* Staff Accounts Table */}
      <div className="botdesk-card overflow-hidden">
        <div className="card-header">
          <div>
            <h2 className="text-base font-bold text-[var(--text)]">Team Accounts</h2>
            <p className="text-xs text-[var(--muted)]">
              Authorized administrators, editors, and read-only viewers
            </p>
          </div>
        </div>

        <div className="card-body p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-[var(--muted)]">
              Loading staff accounts...
            </div>
          ) : staffList.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--muted)]">
              No staff accounts configured.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted)] font-semibold uppercase tracking-wider text-[10px] bg-[var(--surface)]">
                    <th className="py-2.5 px-3">Account Email</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Assigned Bots</th>
                    <th className="py-2.5 px-3">Publishing</th>
                    <th className="py-2.5 px-3">Password</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {staffList.map((member) => (
                    <tr key={member.id} className="hover:bg-[var(--surface)] transition">
                      <td className="py-3 px-3 font-semibold text-[var(--text)]">
                        {member.email}
                        {member.id === sessionUser.id && (
                          <span className="ml-1.5 botdesk-badge blue text-[9px]">You</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`botdesk-badge text-[10px] ${
                            member.role === "SUPER_ADMIN"
                              ? "enabled font-semibold"
                              : member.role === "ADMIN"
                              ? "blue font-semibold"
                              : member.role === "EDITOR"
                              ? "text-amber-400 border-amber-500/40"
                              : "paused"
                          }`}
                        >
                          {member.role}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`botdesk-badge text-[10px] ${
                            member.isActive ? "enabled" : "red"
                          }`}
                        >
                          {member.isActive ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[var(--muted)]">
                        {member.role === "SUPER_ADMIN" ? (
                          <span className="font-semibold text-[var(--accent)]">
                            All Bots (Global)
                          </span>
                        ) : member.staffAssignments.length === 0 ? (
                          <span className="italic text-[var(--muted)]">None assigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {member.staffAssignments.map((a) => (
                              <span key={a.id} className="botdesk-badge text-[10px] surface">
                                {a.bot.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {member.role === "SUPER_ADMIN" || member.role === "ADMIN" ? (
                          <span className="text-emerald-400 font-medium text-[11px]">✓ Full Publish</span>
                        ) : member.role === "EDITOR" ? (
                          member.staffAssignments.some((a) => a.canPublish) ? (
                            <span className="text-emerald-400 font-medium text-[11px]">✓ Can Publish</span>
                          ) : (
                            <span className="text-[var(--muted)] text-[11px]">Drafts Only</span>
                          )
                        ) : (
                          <span className="text-[var(--muted)] text-[11px]">Read Only</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {member.mustChangePassword ? (
                          <span className="botdesk-badge paused text-[9px]" title="Forced reset required on first sign-in">
                            Reset Required
                          </span>
                        ) : (
                          <span className="text-[var(--muted)] text-[11px]">Normal</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(member)}
                          className="botdesk-btn text-[11px] py-1 px-2.5"
                        >
                          Edit
                        </button>
                        {member.id !== sessionUser.id && (
                          <button
                            type="button"
                            disabled={deletingId === member.id}
                            onClick={() => handleDeleteStaff(member)}
                            className="botdesk-btn danger text-[11px] py-1 px-2.5"
                          >
                            {deletingId === member.id ? "Deleting..." : "Delete"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Staff Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="text-base font-bold text-[var(--text)]">
                Add New Staff Account
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="editor@company.com"
                  className="botdesk-input text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Initial Password (Min 8 Characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="botdesk-input text-xs"
                />
                <p className="text-[10px] text-[var(--muted)] italic mt-1">
                  ℹ️ The staff member will be required to change this password immediately upon their first login.
                </p>
              </div>

              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Staff Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="botdesk-input text-xs"
                >
                  <option value="EDITOR">EDITOR — Drafts & Media (Publishing optional)</option>
                  <option value="ADMIN">ADMIN — Assigned Bot Management & Publishing</option>
                  <option value="VIEWER">VIEWER — Read-Only Access (No edits or publishes)</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN — Global Workspace Access & Staff Controls</option>
                </select>
              </div>

              {newRole !== "SUPER_ADMIN" && (
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                  <label className="block font-semibold uppercase text-[var(--muted)] text-[11px]">
                    Assign Telegram Bots
                  </label>
                  {availableBots.length === 0 ? (
                    <p className="text-[11px] text-[var(--muted)] italic">
                      No active bots available to assign.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {availableBots.map((bot) => (
                        <label key={bot.id} className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newAssignedBotIds.includes(bot.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewAssignedBotIds([...newAssignedBotIds, bot.id]);
                              } else {
                                setNewAssignedBotIds(newAssignedBotIds.filter((id) => id !== bot.id));
                              }
                            }}
                            className="rounded border-[var(--border)]"
                          />
                          <span>
                            {bot.name} <span className="text-[var(--muted)] font-mono">(@{bot.username})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {newRole === "EDITOR" && (
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanPublish}
                      onChange={(e) => setNewCanPublish(e.target.checked)}
                      className="rounded border-[var(--border)]"
                    />
                    <span className="font-semibold">
                      Grant Channel Publishing Permission
                    </span>
                  </label>
                  <p className="text-[10px] text-[var(--muted)] ml-5 mt-0.5">
                    When checked, this Editor can publish drafts to assigned channels. When unchecked, they can only create and edit drafts.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="botdesk-btn text-xs py-1.5 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingSubmitting}
                  className="botdesk-btn primary text-xs py-1.5 px-4 font-semibold"
                >
                  {addingSubmitting ? "Creating..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Account Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text)]">
                  Edit Staff Account
                </h3>
                <span className="text-xs text-[var(--muted)] font-mono">
                  {editingStaff.email}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateStaff} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Account Status
                </label>
                <select
                  value={editIsActive ? "ACTIVE" : "DEACTIVATED"}
                  onChange={(e) => setEditIsActive(e.target.value === "ACTIVE")}
                  className="botdesk-input text-xs"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="DEACTIVATED">Deactivated (Blocks login immediately)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Staff Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as any)}
                  className="botdesk-input text-xs"
                >
                  <option value="EDITOR">EDITOR — Drafts & Media (Publishing optional)</option>
                  <option value="ADMIN">ADMIN — Assigned Bot Management & Publishing</option>
                  <option value="VIEWER">VIEWER — Read-Only Access (No edits or publishes)</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN — Global Workspace Access & Staff Controls</option>
                </select>
              </div>

              {editRole !== "SUPER_ADMIN" && (
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                  <label className="block font-semibold uppercase text-[var(--muted)] text-[11px]">
                    Assigned Telegram Bots
                  </label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {availableBots.map((bot) => (
                      <label key={bot.id} className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editAssignedBotIds.includes(bot.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditAssignedBotIds([...editAssignedBotIds, bot.id]);
                            } else {
                              setEditAssignedBotIds(editAssignedBotIds.filter((id) => id !== bot.id));
                            }
                          }}
                          className="rounded border-[var(--border)]"
                        />
                        <span>
                          {bot.name} <span className="text-[var(--muted)] font-mono">(@{bot.username})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {editRole === "EDITOR" && (
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editCanPublish}
                      onChange={(e) => setEditCanPublish(e.target.checked)}
                      className="rounded border-[var(--border)]"
                    />
                    <span className="font-semibold">
                      Grant Channel Publishing Permission
                    </span>
                  </label>
                  <p className="text-[10px] text-[var(--muted)] ml-5 mt-0.5">
                    Allow this Editor to publish posts directly to assigned channels.
                  </p>
                </div>
              )}

              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/20 space-y-1.5">
                <label className="block font-semibold uppercase text-amber-400 text-[11px]">
                  Reset Account Password (Optional)
                </label>
                <input
                  type="password"
                  minLength={8}
                  value={editResetPassword}
                  onChange={(e) => setEditResetPassword(e.target.value)}
                  placeholder="Leave empty to keep existing password"
                  className="botdesk-input text-xs"
                />
                <p className="text-[10px] text-[var(--muted)] italic">
                  Entering a new password will revoke all existing sessions and require the user to change password on next sign-in.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="botdesk-btn text-xs py-1.5 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="botdesk-btn primary text-xs py-1.5 px-4 font-semibold"
                >
                  {editSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
