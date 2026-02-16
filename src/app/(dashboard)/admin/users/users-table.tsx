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
import { createUser, deleteUser } from "./actions";

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
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [actionsContainer, setActionsContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!actionsContainerId) return;
    setActionsContainer(document.getElementById(actionsContainerId));
  }, [actionsContainerId]);

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", displayName: "", password: "", role: "user" },
  });

  async function onCreateSubmit(data: CreateUserValues) {
    const result = await createUser(data);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("User created");
    form.reset();
    setAddOpen(false);
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

  const addUserButton = (
    <Button
      variant="default"
      size="sm"
      onClick={() => setAddOpen(true)}
    >
      Add User
    </Button>
  );

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
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField
                control={form.control}
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
                control={form.control}
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
                control={form.control}
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
                control={form.control}
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
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Creating…" : "Create User"}
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
