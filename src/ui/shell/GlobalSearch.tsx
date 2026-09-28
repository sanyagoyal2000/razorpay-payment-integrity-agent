"use client";

import { Box, SearchInput } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BASE_PATH } from "./nav";

/** Searches cases by payment ID, order ID, customer name, email or phone. */
export function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const submit = () => {
    const query = value.trim();
    if (!query) return;
    router.push(`${BASE_PATH}/cases?q=${encodeURIComponent(query)}`);
  };
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Box width="340px">
        <SearchInput
        accessibilityLabel="Search payments and customers"
        placeholder="Payment ID, order ID, name, email or phone"
        value={value}
        size="medium"
          onChange={({ value: next }) => setValue(next ?? "")}
          onClearButtonClick={() => setValue("")}
        />
      </Box>
    </form>
  );
}
