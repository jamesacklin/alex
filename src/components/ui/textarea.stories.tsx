import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./textarea";
import { Label } from "./label";

const meta: Meta<typeof Textarea> = {
  title: "UI/Textarea",
  component: Textarea,
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: "Add a description for this collection..." },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" placeholder="A curated set of books about..." />
    </div>
  ),
};

export const WithValue: Story = {
  args: {
    defaultValue:
      "A curated collection of classic science fiction novels from the golden age, featuring works by Asimov, Clarke, and Heinlein.",
  },
};

export const Disabled: Story = {
  args: { placeholder: "Disabled textarea", disabled: true },
};
