import type { Metadata } from "next";
import { CheckPaymentPage } from "@/ui/customer/CheckPaymentPage";

export const metadata: Metadata = {
  title: "Check my payment · LearnLoop",
  description: "Check the status of a LearnLoop payment with your phone number and order ID.",
};

export default function Page() {
  return <CheckPaymentPage />;
}
