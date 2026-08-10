import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiAvatar } from '../components/ui/avatar';
import { UiInput } from '../components/ui/input';
import { UiSeparator } from '../components/ui/separator';
import {
  UiDialog,
  UiDialogHeader,
  UiDialogTitle,
  UiDialogFooter,
} from '../components/ui/dialog';
import {
  UiAlertDialog,
  UiAlertDialogHeader,
  UiAlertDialogTitle,
  UiAlertDialogDescription,
  UiAlertDialogFooter,
} from '../components/ui/alert-dialog';
import { UiButton } from '../components/ui/button';
import { UiEmptyState } from '../components/ui/empty-state';
import { UiLabel } from '../components/ui/label';

type Contact = {
  id: number;
  name: string;
  phone: string;
  email: string;
};

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAvatar,
    UiInput,
    UiSeparator,
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogFooter,
    UiAlertDialog,
    UiAlertDialogHeader,
    UiAlertDialogTitle,
    UiAlertDialogDescription,
    UiAlertDialogFooter,
    UiButton,
    UiEmptyState,
    UiLabel,
  ],
  template: `
    <view class="h-screen flex-col bg-zinc-50 flex">
      <view
        class="flex-row items-center border-b border-zinc-200 bg-white px-5 py-4 flex justify-between"
      >
        <text class="text-[22px] font-bold text-zinc-900">Contacts</text>
        <ui-button size="sm" (pressed)="openAdd()">+ Add</ui-button>
      </view>

      <view class="px-4 pb-2 pt-3">
        <ui-input
          [value]="query()"
          (valueChange)="query.set($event)"
          placeholder="Search contacts..."
        />
      </view>

      <scroll-view scroll-orientation="vertical" class="flex-1">
        @if (grouped().length === 0) {
          <view class="p-6">
            <ui-empty-state
              title="No contacts"
              description="Add your first contact above."
            />
          </view>
        }
        @for (group of grouped(); track group.letter) {
          <!--
            The letter header and its contact rows are rendered as flat, direct
            children of the <scroll-view> (no per-group wrapper view). Lynx only
            honours position: sticky on DIRECT children of a scroll-view, so the
            header must not be nested. flatten="false" keeps the header on its
            own layer, which sticky positioning requires on Android.

            z-10 is applied on WEB ONLY. Lynx web makes every <view>
            position: relative, so the contact rows (which follow the header in
            DOM order) are positioned siblings that paint over the pinned header
            and hide it — the header needs elevating above them. On NATIVE a
            z-index promotes the header out of the scroll content and freezes it
            like position: fixed, so it must be omitted there. See
            investigations/lynx-vs-web-differences.md.
          -->
          <view
            class="bg-zinc-100 px-4 py-1.5 sticky top-0"
            [class.z-10]="isWeb"
            [flatten]="false"
          >
            <text class="text-xs font-bold text-zinc-400">{{
              group.letter
            }}</text>
          </view>
          @for (contact of group.contacts; track contact.id; let last = $last) {
            <view
              class="flex-row items-center gap-3 bg-zinc-50 px-4 py-3 flex"
              (bindtap)="viewContact(contact)"
            >
              <ui-avatar size="sm" src="" [fallback]="initials(contact.name)" />
              <view class="flex-1 flex-col gap-0.5 flex">
                <text class="text-[15px] font-medium text-zinc-900">{{
                  contact.name
                }}</text>
                <text class="text-xs text-zinc-400">{{ contact.phone }}</text>
              </view>
            </view>
            @if (!last) {
              <ui-separator class="ml-16" />
            }
          }
        }
      </scroll-view>
    </view>

    @if (selected()) {
      <ui-dialog [(open)]="viewOpen">
        <ui-dialog-header>
          <view class="flex-col items-center gap-2.5 pb-2 flex">
            <ui-avatar
              size="lg"
              src=""
              [fallback]="initials(selected()!.name)"
            />
            <ui-dialog-title>{{ selected()!.name }}</ui-dialog-title>
          </view>
        </ui-dialog-header>
        <view class="flex-col gap-3.5 p-4 flex">
          <view class="flex-col gap-0.5 flex">
            <text class="text-xs text-zinc-400">Phone</text>
            <text class="text-sm text-zinc-900">{{ selected()!.phone }}</text>
          </view>
          <view class="flex-col gap-0.5 flex">
            <text class="text-xs text-zinc-400">Email</text>
            <text class="text-sm text-zinc-900">{{ selected()!.email }}</text>
          </view>
        </view>
        <ui-dialog-footer>
          <ui-button variant="destructive" (pressed)="confirmDelete()">
            Delete
          </ui-button>
          <ui-button (pressed)="viewOpen.set(false)">Close</ui-button>
        </ui-dialog-footer>
      </ui-dialog>
    }

    <ui-dialog [(open)]="addOpen">
      <ui-dialog-header
        ><ui-dialog-title>New Contact</ui-dialog-title>
      </ui-dialog-header>
      <view class="flex-col gap-3.5 p-4 flex">
        <view class="flex-col gap-1.5 flex">
          <ui-label>Name</ui-label>
          <ui-input [(value)]="newName" placeholder="Full name" />
        </view>
        <view class="flex-col gap-1.5 flex">
          <ui-label>Phone</ui-label>
          <ui-input [(value)]="newPhone" placeholder="+1 555 0100" />
        </view>
        <view class="flex-col gap-1.5 flex">
          <ui-label>Email</ui-label>
          <ui-input [(value)]="newEmail" placeholder="name@example.com" />
        </view>
      </view>
      <ui-dialog-footer>
        <ui-button variant="outline" (pressed)="addOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button (pressed)="addContact()">Save</ui-button>
      </ui-dialog-footer>
    </ui-dialog>

    <ui-alert-dialog [(open)]="deleteOpen">
      <ui-alert-dialog-header>
        <ui-alert-dialog-title>Delete Contact</ui-alert-dialog-title>
        <ui-alert-dialog-description>
          Remove {{ selected()?.name }} from your contacts? This cannot be
          undone.
        </ui-alert-dialog-description>
      </ui-alert-dialog-header>
      <ui-alert-dialog-footer>
        <ui-button variant="outline" (pressed)="deleteOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button variant="destructive" (pressed)="deleteContact()">
          Delete
        </ui-button>
      </ui-alert-dialog-footer>
    </ui-alert-dialog>
  `,
})
export class App {
  // __WEB__ is a compile-time define (true on web, false on native). The sticky
  // headers need a z-index ONLY on web — see the header markup for why, and
  // investigations/lynx-vs-web-differences.md.
  readonly isWeb = __WEB__;
  readonly query = signal('');
  readonly viewOpen = signal(false);
  readonly addOpen = signal(false);
  readonly deleteOpen = signal(false);
  readonly selected = signal<Contact | null>(null);
  readonly newName = signal('');
  readonly newPhone = signal('');
  readonly newEmail = signal('');
  #nextId = 6;

  readonly contacts = signal<Contact[]>([
    {
      id: 1,
      name: 'Alice Chen',
      phone: '+1 555 0101',
      email: 'alice@example.com',
    },
    {
      id: 2,
      name: 'Bob Martinez',
      phone: '+1 555 0102',
      email: 'bob@example.com',
    },
    {
      id: 3,
      name: 'Carol White',
      phone: '+1 555 0103',
      email: 'carol@example.com',
    },
    {
      id: 4,
      name: 'David Kim',
      phone: '+1 555 0104',
      email: 'david@example.com',
    },
    {
      id: 5,
      name: 'Eva Lopez',
      phone: '+1 555 0105',
      email: 'eva@example.com',
    },
  ]);

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.contacts();
    return this.contacts().filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  });

  readonly grouped = computed(() => {
    const sorted = [...this.filtered()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const map = new Map<string, Contact[]>();
    for (const c of sorted) {
      const letter = c.name[0].toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return Array.from(map.entries()).map(([letter, contacts]) => ({
      letter,
      contacts,
    }));
  });

  initials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  viewContact(c: Contact): void {
    this.selected.set(c);
    this.viewOpen.set(true);
  }

  openAdd(): void {
    this.newName.set('');
    this.newPhone.set('');
    this.newEmail.set('');
    this.addOpen.set(true);
  }

  addContact(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.contacts.update((list) => [
      ...list,
      {
        id: this.#nextId++,
        name,
        phone: this.newPhone(),
        email: this.newEmail(),
      },
    ]);
    this.addOpen.set(false);
  }

  confirmDelete(): void {
    this.viewOpen.set(false);
    this.deleteOpen.set(true);
  }

  deleteContact(): void {
    const id = this.selected()!.id;
    this.contacts.update((list) => list.filter((c) => c.id !== id));
    this.selected.set(null);
    this.deleteOpen.set(false);
  }
}
