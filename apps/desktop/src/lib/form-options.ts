import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const confirmResetSchema = z.literal("RESET");

export const confirmResetFormOptions = formOptions({
  defaultValues: {
    confirm: "",
  },
});
