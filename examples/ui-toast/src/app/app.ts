import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiToaster, toast } from '../components/ui/toast';
import { UiButton } from '../components/ui/button';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiToaster, UiButton],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-4 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Toast</text>

        <ui-button (pressed)="showDefault()">Show Toast</ui-button>

        <ui-button variant="outline" (pressed)="showWithDescription()">
          With Description
        </ui-button>

        <ui-button variant="destructive" (pressed)="showDestructive()">
          Destructive
        </ui-button>

        <ui-button variant="secondary" (pressed)="showWithAction()">
          With Action
        </ui-button>

        <ui-button variant="outline" (pressed)="showSeveral()">
          Show Several (stack)
        </ui-button>
      </view>

      <ui-toaster />
    </scroll-view>
  `,
})
export class App {
  showDefault(): void {
    toast({ title: 'Event has been created' });
  }

  showWithDescription(): void {
    toast({
      title: 'Event has been created',
      description: 'Sunday, December 03, 2023 at 9:00 AM',
    });
  }

  showDestructive(): void {
    toast({
      title: 'Uh oh! Something went wrong.',
      description: 'There was a problem with your request.',
      variant: 'destructive',
    });
  }

  showWithAction(): void {
    toast({
      title: 'Message sent',
      description: 'Your message has been delivered.',
      action: {
        label: 'Undo',
        onAction: () => {
          toast({ title: 'Message unsent' });
        },
      },
    });
  }

  /**
   * Fire several toasts in quick succession to show the stack: 3 pile up
   * (newest in front, older ones scaled down and shifted up), and the rest
   * queue behind, sliding in as each front toast is dismissed.
   */
  showSeveral(): void {
    const items = [
      { title: 'File uploaded', description: 'report.pdf' },
      { title: 'File uploaded', description: 'photo.jpg' },
      { title: 'File uploaded', description: 'data.csv' },
      { title: 'File uploaded', description: 'notes.txt' },
      { title: 'All uploads complete', description: '4 files' },
    ];
    items.forEach((item, i) => {
      setTimeout(() => toast(item), i * 350);
    });
  }
}
