"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { generateUniqueString } from "@/lib/utils";
import { createBankAccount } from "@/lib/actions/bank.actions";
import Image from "next/image";

// Define the bank type based on API response
interface Bank {
  name: string;
  shortName: string;
  bankCode: string;
  logo: string;
}

// Transform API bank data to component format
interface BankOption {
  value: string;
  label: string;
  logo: string;
}

interface AddBankProps {
  userId: string;
}

const formSchema = z.object({
  accountNumber: z.string().min(6, {
    message: "Account number must be 8 digits.",
  }),
  cardNumber: z.string().min(16, {
    message: "Card number must be 16 digits.",
  }),
  ownerName: z.string().min(1, {  
    message: "Owner name is required.",  
  }).min(2, {  
    message: "Owner name must be at least 2 characters."  
  }), 
  availableBalance: z.string().min(1, {
    message: "Available balance is required.",
  }),
  currentBalance: z.string().min(1, {
    message: "Current balance is required.",
  }),
  isActivated: z.boolean().default(true),
});

export function AddBank({ userId }: AddBankProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isBanksLoading, setIsBanksLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [selectedBank, setSelectedBank] = useState<BankOption | null>(null);

  // Fetch banks from API
  useEffect(() => {
    const fetchBanks = async () => {
      try {
        setIsBanksLoading(true);
        const response = await fetch('/api/getinfos/bankList');
        const result = await response.json();
        
        if (result.success && result.data) {
          // Transform API data to component format
          const transformedBanks: BankOption[] = result.data.map((bank: Bank) => ({
            value: bank.bankCode,
            label: `${bank.shortName} - ${bank.name}`,
            logo: bank.logo
          }));
          setBanks(transformedBanks);
        } else {
          toast({
            variant: "destructive",
            description: "Failed to load bank list. Please try again.",
          });
        }
      } catch (error) {
        console.error('Error fetching banks:', error);
        toast({
          variant: "destructive",
          description: "Failed to load bank list. Please try again.",
        });
      } finally {
        setIsBanksLoading(false);
      }
    };

    fetchBanks();
  }, [toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountNumber: "",
      cardNumber: "",
      ownerName: "",
      availableBalance: "0",
      currentBalance: "0",
      isActivated: true,
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    if (!selectedBank) {
      toast({
        variant: "destructive",
        description: "Please select a bank.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const bankData = {
        bankId: generateUniqueString({ length: 10, includeUppercase: true }),
        bankName: selectedBank.label,
        accountNumber: data.accountNumber,
        cardNumber: data.cardNumber,
        ownerName: data.ownerName,
        availableBalance: data.availableBalance,
        currentBalance: data.currentBalance,
        userId: userId,
        isActivated: data.isActivated,
        bankBinCode: selectedBank.value,
      };

      const newBank = await createBankAccount(bankData);

      if (newBank) {
        toast({
          description: "Bank account added successfully!",
        });
        form.reset();
        setSelectedBank(null);
        router.refresh();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        description: "Failed to add bank account. Please try again.",
      });
      console.error(error);
    }
    setIsLoading(false);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <FormLabel>Bank Name</FormLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between"
                disabled={isBanksLoading}
              >
                {isBanksLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading banks...</span>
                  </div>
                ) : selectedBank ? (
                  selectedBank.label
                ) : (
                  "Select bank..."
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] bg-white p-0">
              <Command>
                <CommandInput placeholder="Search bank..." />
                <CommandList>
                  <CommandEmpty>
                    {isBanksLoading ? "Loading banks..." : "No bank found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {banks.map((bank) => (
                      <CommandItem
                        key={bank.value}
                        onSelect={() => {
                          setSelectedBank(bank);
                          setOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center relative">
                            <Image 
                              src={bank.logo} 
                              alt={bank.label}
                              width={64}
                              height={64}
                              className="object-contain"
                              unoptimized={true}
                              onError={(e) => {
                                // Show a fallback icon or hide if image fails to load
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          </div>
                          <span className="flex-1">{bank.label}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <FormField
          control={form.control}
          name="accountNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Account Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter Account number" {...field} />
              </FormControl>
              <FormMessage className="text-sm text-red-500 mt-1" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="cardNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Card Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter Card number" {...field} />
              </FormControl>
              <FormMessage className="text-sm text-red-500 mt-1" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="ownerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Owner Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter owner name" {...field} />
              </FormControl>
              <FormMessage className="text-sm text-red-500 mt-1" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="availableBalance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Available Balance</FormLabel>
              <FormControl>
                <Input
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  min="0"
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-sm text-red-500 mt-1" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="currentBalance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current Balance</FormLabel>
              <FormControl>
                <Input
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  min="0"
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-sm text-red-500 mt-1" />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full form-btn-shadow"
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Adding Bank...</span>
            </div>
          ) : (
            "Add Bank"
          )}
        </Button>
      </form>
    </Form>
  );
}
