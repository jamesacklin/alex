import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./card";
import { Button } from "./button";

const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Collection Settings</CardTitle>
        <CardDescription>Manage your collection preferences</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your collection contains 42 books across 3 categories.
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Science Fiction</CardTitle>
        <CardDescription>12 books in this collection</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            Share
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          A curated set of classic and contemporary science fiction novels.
        </p>
      </CardContent>
    </Card>
  ),
};

export const SetupCard: Story = {
  render: () => (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Welcome</CardTitle>
        <CardDescription>
          Create your admin account to get started
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="h-8 rounded-md border bg-transparent" />
          <div className="h-8 rounded-md border bg-transparent" />
          <div className="h-8 rounded-md border bg-transparent" />
          <Button className="w-full">Create account</Button>
        </div>
      </CardContent>
    </Card>
  ),
};
