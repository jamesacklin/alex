import type { Meta, StoryObj } from "@storybook/react";
import { ReadingProgressMeter } from "./ReadingProgressMeter";

const meta: Meta<typeof ReadingProgressMeter> = {
  title: "Library/ReadingProgressMeter",
  component: ReadingProgressMeter,
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReadingProgressMeter>;

export const Default: Story = {
  args: { percentComplete: 42 },
};

export const JustStarted: Story = {
  args: { percentComplete: 3 },
};

export const Halfway: Story = {
  args: { percentComplete: 50 },
};

export const AlmostDone: Story = {
  args: { percentComplete: 94 },
};

export const Completed: Story = {
  args: { percentComplete: 100, label: "Completed" },
};

export const Compact: Story = {
  args: { percentComplete: 67, compact: true },
};

export const WithPrecision: Story = {
  args: { percentComplete: 33.3333, precision: 1 },
};

export const CustomLabel: Story = {
  args: { percentComplete: 25, label: "Chapter 4 of 16" },
};

export const AllStates: Story = {
  render: () => (
    <div className="space-y-4">
      <ReadingProgressMeter percentComplete={0} label="Not started" />
      <ReadingProgressMeter percentComplete={15} />
      <ReadingProgressMeter percentComplete={50} />
      <ReadingProgressMeter percentComplete={85} />
      <ReadingProgressMeter percentComplete={100} label="Completed" />
    </div>
  ),
};
