import React, { useEffect, useState } from "react";
import { FormControl, FormField, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { Control, FieldPath } from "react-hook-form";
import { z } from "zod";
import { authFormSchema } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

type FormSchema = z.infer<ReturnType<typeof authFormSchema>>;

interface CustomInput {
  control: Control<FormSchema>;
  name: FieldPath<FormSchema>;
  label: string;
  placeholder: string;
}
const CustomInput = ({ control, name, label, placeholder }: CustomInput) => {
  const [type, setType] = useState("text");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (name === "password") {
      setType("password");
    }
  }, [name]);

  const togglePasswordVisibility = () => {
    if (name === "password") {
      setShowPassword(!showPassword);
      setType(showPassword ? "password" : "text");
    }
  };

  // Generate a unique id based on the field name
  const id = `${name}-input`;

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <div className="form-item">
          <FormLabel className="form-label">{label}</FormLabel>
          <div className="flex w-full flex-col">
            <FormControl>
              <div className="relative">
                <Input
                  id={id}
                  placeholder={placeholder}
                  className="input-class"
                  type={type}
                  autoComplete={
                    name === "password"
                      ? "current-password"
                      : name === "email"
                      ? "email"
                      : "off"
                  }
                  {...field}
                />
                {name === "password" && (
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </FormControl>
            <FormMessage className="form-message mt-2" />
          </div>
        </div>
      )}
    />
  );
};

export default CustomInput;
