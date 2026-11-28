import '@angular/compiler';
import {
  HttpRequest,
  HttpResponse,
  type HttpEvent,
} from '@angular/common/http';
import { of, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { httpRelayInterceptor, setHttpRelay } from './http-relay-hook';

describe('httpRelayInterceptor', () => {
  const request = new HttpRequest('GET', 'https://api.example.com/data');
  const next = vi.fn((): Observable<HttpEvent<unknown>> =>
    of(new HttpResponse({ body: 'next' })),
  );

  it('passes every request on until the relay is set', () => {
    httpRelayInterceptor(request, next);
    expect(next).toHaveBeenCalledWith(request);
  });

  it('hands each request to the relay once it is set', () => {
    const relay = vi.fn(() => of(new HttpResponse({ body: 'relay' })));
    setHttpRelay(relay);
    next.mockClear();
    httpRelayInterceptor(request, next);
    expect(relay).toHaveBeenCalledWith(request, next);
    expect(next).not.toHaveBeenCalled();
  });
});
