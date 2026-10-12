import { provideRouter } from '@angular/router';
import { render } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';

import { Hello } from './hello';

describe('Hello (E2E counter fixture)', () => {
  it('renders the count', async () => {
    const { getByText } = await render(Hello, {
      providers: [provideRouter([])],
    });
    expect(getByText('Count: 0')).toBeTruthy();
  });
});
