"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
  Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table,
  TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip,
  TooltipContent, TooltipProvider, TooltipTrigger,
} from "@alex/ui";
import {
  createUser,
  deleteUser,
  setUserDisabled,
  updateUser,
  updateUserPassword,
} from "./actions";

/**
 * Inline busy indicator.
 *
 * `aria-hidden` because the accessible name comes from the adjacent
 * `sr-only` text; `motion-safe:` so the spin is dropped for anyone who has
 * asked for reduced motion.
 */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 motion-safe:animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: number;
  /** Unix seconds when the account was deactivated, or null. */
  disabledAt: number | null;
  /** 1 when the account has a usable bcrypt password, 0 otherwise. */
  canSignIn: number;
};

const createUserSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+$/, "Must be a valid email"),
  displayName: z.string().min(1, "Display name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "user"]),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  role: z.enum(["admin", "user"]),
});

type EditUserValues = z.infer<typeof editUserSchema>;

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
}).refine(
  (values) => values.password === values.confirmPassword,
  {
    message: "Passwords must match",
    path: ["confirmPassword"],
  },
);

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export default function UsersTable({
  users,
  currentUserId,
  actionsContainerId,
}: {
  users: UserRow[];
  currentUserId: string;
  actionsContainerId?: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserEmail, setEditUserEmail] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordUserEmail, setPasswordUserEmail] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [actionsContainer, setActionsContainer] = useState<HTMLElement | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [hasRemoteCredentials, setHasRemoteCredentials] = useState(true);
  const [ownershipClaimed, setOwnershipClaimed] = useState(true);

  useEffect(() => {
    if (!actionsContainerId) return;
    setActionsContainer(document.getElementById(actionsContainerId));
  }, [actionsContainerId]);

  const refreshTunnelStatus = useCallback(() => {
    if (typeof window === "undefined" || !window.electronAPI?.getTunnelStatus) return;
    window.electronAPI.getTunnelStatus().then((status) => {
      setTunnelEnabled(status.enabled);
      setTunnelUrl(status.url || "");
      setHasRemoteCredentials(status.hasRemoteCredentials);
      setOwnershipClaimed(status.ownershipClaimed);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshTunnelStatus();
  }, [refreshTunnelStatus]);

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
  }

  const createForm = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", displayName: "", password: "", role: "user" },
  });

  const editForm = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { displayName: "", role: "user" },
  });

  const passwordForm = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onCreateSubmit(data: CreateUserValues) {
    const result = await createUser(data);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("User created");
    createForm.reset();
    setAddOpen(false);
    router.refresh();
  }

  async function onEditSubmit(data: EditUserValues) {
    if (!editUserId) return;
    const result = await updateUser(editUserId, data);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("User updated");
    setEditOpen(false);
    setEditUserId(null);
    setEditUserEmail("");
    editForm.reset();
    router.refresh();
  }

  async function toggleDisabled(user: UserRow) {
    const result = await setUserDisabled(user.id, user.disabledAt === null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(
      user.disabledAt === null ? "Account disabled" : "Account enabled",
      {
        description:
          user.disabledAt === null
            ? "Any session it already held stops working immediately."
            : undefined,
      },
    );
    refreshTunnelStatus();
    router.refresh();
  }

  async function onDelete() {
    if (!deleteId) return;
    const result = await deleteUser(deleteId);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("User deleted");
      router.refresh();
    }
    setDeleteId(null);
  }

  async function onPasswordSubmit(data: ResetPasswordValues) {
    if (!passwordUserId) return;
    const result = await updateUserPassword(passwordUserId, {
      password: data.password,
    });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Password updated");
    setPasswordOpen(false);
    setPasswordUserId(null);
    setPasswordUserEmail("");
    passwordForm.reset();
  }

  function openEditDialog(user: UserRow) {
    setEditUserId(user.id);
    setEditUserEmail(user.email);
    editForm.reset({
      displayName: user.displayName,
      role: user.role === "admin" ? "admin" : "user",
    });
    setEditOpen(true);
  }

  function openPasswordDialog(user: UserRow) {
    setPasswordUserId(user.id);
    setPasswordUserEmail(user.email);
    passwordForm.reset({ password: "", confirmPassword: "" });
    setPasswordOpen(true);
  }

  const addUserButton = (
    <Button
      variant="default"
      size="sm"
      onClick={() => setAddOpen(true)}
    >
      Add User
    </Button>
  );

  async function toggleTunnel() {
    if (!window.electronAPI) return;
    setTunnelLoading(true);
    try {
      if (tunnelEnabled) {
        await window.electronAPI.disableTunnel();
        setTunnelEnabled(false);
        setTunnelUrl("");
        toast.success("Public access disabled");
      } else {
        const result = await window.electronAPI.enableTunnel();
        if ("error" in result) {
          if (result.error === "no-remote-credentials") {
            setHasRemoteCredentials(false);
            toast.error("Add an account that can sign in first", {
              description:
                "The desktop app signs you in locally without a password, so there is no credential to publish. Use Add User to create an account for remote access.",
            });
          } else {
            toast.error("Could not enable public access");
          }
          return;
        }
        setTunnelEnabled(true);
        setTunnelUrl(result.url);
        setOwnershipClaimed(true);
        toast.success("Public access enabled", {
          description: result.rotated
            ? "Your public URL changed: the previous name predated authenticated relay registration and could not be proven as yours."
            : undefined,
        });
      }
    } catch {
      toast.error("Failed to toggle public access");
    } finally {
      setTunnelLoading(false);
    }
  }

  async function regenerateSubdomain() {
    if (!window.electronAPI) return;
    setTunnelLoading(true);
    try {
      const result = await window.electronAPI.regenerateTunnelSubdomain();
      setTunnelUrl(result.url);
      setOwnershipClaimed(true);
      toast.success("Public URL regenerated", {
        description: "Anyone holding the previous link will no longer reach this library.",
      });
    } catch {
      toast.error("Failed to regenerate URL");
    } finally {
      setTunnelLoading(false);
    }
  }

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.getTunnelStatus;

  return (
    <TooltipProvider>
      {actionsContainerId
        ? actionsContainer
          ? createPortal(addUserButton, actionsContainer)
          : null
        : (
            <div className="flex justify-end mb-4">
              {addUserButton}
            </div>
          )}

      {isElectron && (
        <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Public Access (Relay)</p>
              <p className="text-xs text-muted-foreground">
                Enable this to expose your library at a stable public URL. This is required for sharing collections with people outside your local network.
              </p>
              {!hasRemoteCredentials && (
                <p className="mt-1 text-xs text-destructive">
                  Add a user below first. The desktop app signs you in without a
                  password, so there is no credential a remote visitor could use.
                </p>
              )}
              {tunnelEnabled && !ownershipClaimed && (
                <p className="mt-1 text-xs text-destructive">
                  This public URL predates authenticated relay registration and
                  cannot be proven as yours. Regenerate it to claim a new name.
                </p>
              )}
            </div>
            <Button
              variant={tunnelEnabled ? "default" : "outline"}
              size="sm"
              onClick={toggleTunnel}
              disabled={tunnelLoading || (!tunnelEnabled && !hasRemoteCredentials)}
              aria-busy={tunnelLoading}
              className="shrink-0"
            >
              {tunnelLoading ? (
                <>
                  <Spinner />
                  <span className="sr-only">Working…</span>
                </>
              ) : tunnelEnabled ? (
                "Enabled"
              ) : (
                "Disabled"
              )}
            </Button>
          </div>
          {tunnelEnabled && tunnelUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 text-xs font-mono border border-border">
                  {tunnelUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyUrl(tunnelUrl)}
                  className="shrink-0 text-xs h-7"
                >
                  {copiedUrl === tunnelUrl ? "Copied!" : "Copy"}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={regenerateSubdomain}
                disabled={tunnelLoading}
                className="text-xs text-muted-foreground"
              >
                Regenerate URL
              </Button>
            </div>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isOwn = user.id === currentUserId;
            return (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.displayName}</TableCell>
                <TableCell>
                  <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.disabledAt !== null ? (
                    <Badge variant="destructive">disabled</Badge>
                  ) : user.canSignIn ? (
                    <Badge variant="secondary">active</Badge>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Badge variant="outline">local only</Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        This account has no password and cannot sign in over the
                        network. The desktop app uses it locally.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt * 1000).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(user)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPasswordDialog(user)}
                    >
                      Change Password
                    </Button>
                    {isOwn ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="outline" size="sm" disabled>
                              Disable
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Cannot disable your own account
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleDisabled(user)}
                      >
                        {user.disabledAt !== null ? "Enable" : "Disable"}
                      </Button>
                    )}
                    {isOwn ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="destructive" size="sm" disabled>
                              Delete
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Cannot delete your own account
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setDeleteId(user.id);
                          setDeleteEmail(user.email);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create a new user account
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="user@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={createForm.formState.isSubmitting}
              >
                {createForm.formState.isSubmitting ? "Creating…" : "Create User"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditUserId(null);
            setEditUserEmail("");
            editForm.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update role and display name for {editUserEmail || "this user"}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={editForm.formState.isSubmitting}
              >
                {editForm.formState.isSubmitting ? "Saving…" : "Save Changes"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) {
            setPasswordUserId(null);
            setPasswordUserEmail("");
            passwordForm.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {passwordUserEmail || "this user"}
            </DialogDescription>
          </DialogHeader>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              <FormField
                control={passwordForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={passwordForm.formState.isSubmitting}
              >
                {passwordForm.formState.isSubmitting ? "Saving…" : "Update Password"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteEmail}</strong>. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 max-w-full"
            >
              <span className="truncate">Delete {deleteEmail}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
