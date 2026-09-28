"use client";

import { ActionList, ActionListItem, Dropdown, DropdownOverlay, FilterChipSelectInput } from "@razorpay/blade/components";

export type FilterOption = { value: string; label: string };

/** A Blade filter chip backed by a dropdown of options. */
export function SelectFilterChip({
  label,
  options,
  values,
  onChange,
  multiple = false,
}: {
  label: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <Dropdown selectionType={multiple ? "multiple" : "single"}>
      <FilterChipSelectInput
        label={label}
        value={multiple ? values : values[0] ?? ""}
        onChange={({ values: next }) => onChange(next)}
        onClearButtonClick={() => onChange([])}
      />
      <DropdownOverlay>
        <ActionList>
          {options.map((option) => (
            <ActionListItem key={option.value} title={option.label} value={option.value} isSelected={values.includes(option.value)} />
          ))}
        </ActionList>
      </DropdownOverlay>
    </Dropdown>
  );
}
