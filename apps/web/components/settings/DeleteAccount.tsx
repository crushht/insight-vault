"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Eye, EyeOff, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  useDeleteAccount,
  useWhoAmI,
} from "@karakeep/shared-react/hooks/users";

import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsPage";

const createDeleteAccountSchema = (isLocalUser: boolean) =>
  z.object({
    password: isLocalUser
      ? z.string().min(1, "Password is required")
      : z.string().optional(),
  });

export function DeleteAccount() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { data: user } = useWhoAmI();

  const isLocalUser = user?.localUser ?? false;
  const deleteAccountSchema = createDeleteAccountSchema(isLocalUser);

  const form = useForm<z.infer<typeof deleteAccountSchema>>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: {
      password: "",
    },
  });

  const deleteAccountMutation = useDeleteAccount({
    onSuccess: () => {
      setServerError(null);
      toast({
        description: "Your account has been successfully deleted.",
      });
      // Redirect to home page after successful deletion
      router.push("/");
      setIsDialogOpen(false);
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED") {
        form.setError("password", {
          type: "server",
          message: "Invalid password. Please try again.",
        });
        setServerError(null);
        return;
      }

      if (error.data?.code === "BAD_REQUEST") {
        setServerError(error.message);
        return;
      }

      toast({
        description: "删除失败，请重试。",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: z.infer<typeof deleteAccountSchema>) => {
    setServerError(null);
    form.clearErrors();
    deleteAccountMutation.mutate({ password: values.password });
  };

  const handleDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setServerError(null);
      form.clearErrors();
    }
  };

  return (
    <SettingsSection title="危险区域" variant="danger">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">删除账号</h3>
        <p className="text-sm text-muted-foreground">
          永久删除你的账号与所有关联数据。此操作不可撤销。
        </p>
      </div>

      <ActionConfirmingDialog
        open={isDialogOpen}
        setOpen={handleDialogOpenChange}
        title="删除账号"
        description={
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
              <div className="space-y-2">
                <p className="font-medium text-destructive">
                  这个操作不可撤销
                </p>
                <p className="text-sm text-muted-foreground">
                  All your bookmarks, lists, tags, highlights, and other data
                  将被永久删除，且无法恢复。
                </p>
              </div>
            </div>
            {serverError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                {isLocalUser && (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          输入密码以确认删除
                        </FormLabel>
                        <div className="relative">
                          <FormControl>
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="输入密码"
                              className="pr-10"
                              {...field}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent has-[>svg]:px-3 dark:hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </form>
            </Form>
          </div>
        }
        actionButton={() => (
          <ActionButton
            variant="destructive"
            loading={deleteAccountMutation.isPending}
            onClick={form.handleSubmit(onSubmit)}
          >
            <Trash2 className="h-4 w-4" />
            删除账号
          </ActionButton>
        )}
      >
        <Button variant="destructiveOutline">
          <Trash2 className="h-4 w-4" />
          删除账号
        </Button>
      </ActionConfirmingDialog>
    </SettingsSection>
  );
}
