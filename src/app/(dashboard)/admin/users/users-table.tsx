"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createUser, deleteUser, updateUser, updateUserPassword } from "./actions";

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: number;
};

const createUserSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+$/, "Must be a valid email"),
  displayName: z.string().min(1, "Display name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "user"]),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  role: z.enum(["admin", "user"]),
});

type EditUserValues = z.infer<typeof editUserSchema>;

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
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
  webServerUrl,
}: {
  users: UserRow[];
  currentUserId: string;
  actionsContainerId?: string;
  webServerUrl?: string | null;
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
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);

  useEffect(() => {
    if (!actionsContainerId) return;
    setActionsContainer(document.getElementById(actionsContainerId));
  }, [actionsContainerId]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI?.getLocalIps) {
      window.electronAPI.getLocalIps().then(setLocalIps).catch(() => {});
    }
    if (typeof window !== "undefined" && window.electronAPI?.getTunnelStatus) {
      window.electronAPI.getTunnelStatus().then((status: { enabled: boolean; url: string }) => {
        setTunnelEnabled(status.enabled);
        setTunnelUrl(status.url || "");
      }).catch(() => {});
    }
  }, []);

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
        const result = await window.electronAPI.enableTunnel() as { subdomain: string; url: string };
        setTunnelEnabled(true);
        setTunnelUrl(result.url);
        toast.success("Public access enabled");
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
      const result = await window.electronAPI.regenerateTunnelSubdomain() as { subdomain: string; url: string };
      setTunnelUrl(result.url);
      toast.success("Public URL regenerated");
    } catch {
      toast.error("Failed to regenerate URL");
    } finally {
      setTunnelLoading(false);
    }
  }

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.getTunnelStatus;
  const serverUrls = localIps.length > 0 ? localIps : webServerUrl ? [webServerUrl] : [];

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

      {serverUrls.length > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">Server URL</p>
          <p className="text-xs text-muted-foreground">
            Share this address so others can access the server from their devices.
          </p>
          <div className="space-y-1.5">
            {serverUrls.map((url) => (
              <div key={url} className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 text-xs font-mono border border-border">
                  {url}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyUrl(url)}
                  className="shrink-0 text-xs h-7"
                >
                  {copiedUrl === url ? "Copied!" : "Copy"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isElectron && (
        <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Public Access</p>
              <p className="text-xs text-muted-foreground">
                Expose your library at a public URL so anyone with the link can access it.
              </p>
            </div>
            <Button
              variant={tunnelEnabled ? "default" : "outline"}
              size="sm"
              onClick={toggleTunnel}
              disabled={tunnelLoading}
              className="shrink-0"
            >
              {tunnelLoading ? "..." : tunnelEnabled ? "Enabled" : "Disabled"}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
