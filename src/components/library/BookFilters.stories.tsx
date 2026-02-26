import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { BookFilters } from "./BookFilters";

const meta: Meta<typeof BookFilters> = {
  title: "Library/BookFilters",
  component: BookFilters,
};

export default meta;
type Story = StoryObj<typeof BookFilters>;

export const Default: Story = {
  args: {
    type: "all",
    status: "all",
    sort: "added",
    hasFilters: false,
    onTypeChange: () => {},
    onStatusChange: () => {},
    onSortChange: () => {},
    onClearFilters: () => {},
  },
};

export const WithActiveFilters: Story = {
  args: {
    type: "epub",
    status: "reading",
    sort: "read",
    hasFilters: true,
    onTypeChange: () => {},
    onStatusChange: () => {},
    onSortChange: () => {},
    onClearFilters: () => {},
  },
};

export const PdfOnly: Story = {
  args: {
    type: "pdf",
    status: "all",
    sort: "added",
    hasFilters: true,
    onTypeChange: () => {},
    onStatusChange: () => {},
    onSortChange: () => {},
    onClearFilters: () => {},
  },
};

function InteractiveBookFilters() {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("added");
  const hasFilters = type !== "all" || status !== "all" || sort !== "added";

  return (
    <BookFilters
      type={type}
      status={status}
      sort={sort}
      hasFilters={hasFilters}
      onTypeChange={setType}
      onStatusChange={setStatus}
      onSortChange={setSort}
      onClearFilters={() => {
        setType("all");
        setStatus("all");
        setSort("added");
      }}
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveBookFilters />,
};
