import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CollectionFilters } from "./CollectionFilters";

const meta: Meta<typeof CollectionFilters> = {
  title: "Library/CollectionFilters",
  component: CollectionFilters,
};

export default meta;
type Story = StoryObj<typeof CollectionFilters>;

export const AllSelected: Story = {
  args: {
    filter: "all",
    onFilterChange: () => {},
  },
};

export const PrivateSelected: Story = {
  args: {
    filter: "private",
    onFilterChange: () => {},
  },
};

export const SharedSelected: Story = {
  args: {
    filter: "shared",
    onFilterChange: () => {},
  },
};

function InteractiveCollectionFilters() {
  const [filter, setFilter] = useState("all");
  return <CollectionFilters filter={filter} onFilterChange={setFilter} />;
}

export const Interactive: Story = {
  render: () => <InteractiveCollectionFilters />,
};
