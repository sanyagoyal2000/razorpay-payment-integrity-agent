import type { Metadata } from "next";
import { CheckPaymentPage } from "@/ui/customer/CheckPaymentPage";

export const metadata: Metadata = {
  title: "Check my payment · Marrow",
  description: "Check the status of a Marrow payment with your phone number and order ID.",
};

export default function Page() {
  return <CheckPaymentPage />;
}
