"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Form,
  FormControl, FormField, FormItem, FormLabel, FormMessage, Input,
} from "@alex/ui";
import { createAdmin } from "./actions";

const setupSchema = z
  .object({
    setupToken: z.string().min(1, "Setup token is required"),
    email: z.string().regex(/^[^\s@]+@[^\s@]+$/, "Must be a valid email"),
    displayName: z.string().min(1, "Display name is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });

type SetupValues = z.infer<typeof setupSchema>;

export default function SetupForm({ tokenLocation }: { tokenLocation: string }) {
  const router = useRouter();
  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      setupToken: "",
      email: "",
      displayName: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit({ setupToken, email, displayName, password }: SetupValues) {
    const result = await createAdmin({ setupToken, email, displayName, password });

    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    toast.success("Admin account created");
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Welcome</CardTitle>
          <CardDescription>
            Create your admin account to get started. Alex printed a one-time
            setup token to the server log and saved it at{" "}
            <code className="break-all font-mono text-xs">{tokenLocation}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="setupToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Setup token</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Paste the token from the server log"
                        autoComplete="off"
                        // The token is hex and compared byte-for-byte, so a
                        // mobile keyboard capitalising the first character
                        // turns a correct paste into "Invalid or expired
                        // setup token" with nothing to explain it.
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        autoComplete="email"
                        {...field}
                      />
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
                      <Input placeholder="Admin" {...field} />
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
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
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
                {form.formState.isSubmitting ? "Creating account…" : "Create account"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
