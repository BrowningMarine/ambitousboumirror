"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateUniqueString } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { createAccount } from "@/lib/actions/account.actions";

interface User {
  $id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  displayName?: string;
}

interface CreateAccountFormProps {
  users: User[];
}

export default function CreateAccountForm({ users }: CreateAccountFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    accountName: "",
    selectedUserId: "",
    status: false,
    apiKey: generateUniqueString({ length: 24, includeUppercase: true }),
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleUserSelect = (userId: string) => {
    setFormData((prev) => ({ ...prev, selectedUserId: userId }));
  };

  const handleStatusChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, status: checked }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!formData.selectedUserId) {
      toast({
        variant: "destructive",
        description: "Please select a user for this account.",
      });
      return;
    }

    if (!formData.accountName) {
      toast({
        variant: "destructive",
        description: "Please enter an account name.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate a public transaction ID
      const publicTransactionId = generateUniqueString({
        length: 10,
        includeUppercase: true,
      });

      // Call the server action to create the account
      const result = await createAccount({
        accountName: formData.accountName,
        userId: formData.selectedUserId,
        publicTransactionId,
        status: formData.status,
        apiKey: formData.apiKey,
        avaiableBalance: 0,
        currentBalance: 0,
      });

      if (result) {
        toast({
          description: "Account created successfully!",
        });
        router.push("/accounts");
        router.refresh();
      } else {
        throw new Error("Failed to create account");
      }
    } catch (error) {
      console.error("Error creating account:", error);
      toast({
        variant: "destructive",
        description: "Failed to create account. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="accountName">Account Name</Label>
        <Input
          id="accountName"
          name="accountName"
          value={formData.accountName}
          onChange={handleChange}
          placeholder="Enter account name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user">Select User</Label>
        <Select
          value={formData.selectedUserId}
          onValueChange={handleUserSelect}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a user" />
          </SelectTrigger>
          <SelectContent>
            <div className="bg-white">
              {users.map((user) => (
                <SelectItem key={user.$id} value={user.$id}>
                  {user.displayName ||
                    `${user.firstName} ${user.lastName}` ||
                    user.email}
                </SelectItem>
              ))}
            </div>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          name="apiKey"
          value={formData.apiKey}
          onChange={handleChange}
          placeholder="API Key"
          readOnly
        />
        <p className="text-sm text-gray-500">
          Auto-generated API key that can be used for integration
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="status"
          checked={formData.status}
          onCheckedChange={handleStatusChange}
        />
        <Label htmlFor="status">Active</Label>
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full form-btn">
        {isSubmitting ? "Creating..." : "Create Account"}
      </Button>
    </form>
  );
}
