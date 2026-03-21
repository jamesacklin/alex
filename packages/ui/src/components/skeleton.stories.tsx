import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "UI/Skeleton",
  component: Skeleton,
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: { className: "h-4 w-48 rounded-md" },
};

export const Circle: Story = {
  args: { className: "h-10 w-10 rounded-full" },
};

export const BookCardSkeleton: Story = {
  render: () => (
    <div className="w-48 space-y-2">
      <Skeleton className="aspect-[2/3] w-full rounded-sm" />
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
      <Skeleton className="h-3 w-1/3 rounded-md" />
    </div>
  ),
};

export const TableRowSkeleton: Story = {
  render: () => (
    <div className="flex items-center gap-4 py-3">
      <Skeleton className="h-4 w-40 rounded-md" />
      <Skeleton className="h-4 w-28 rounded-md" />
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-4 w-20 rounded-md" />
    </div>
  ),
};
