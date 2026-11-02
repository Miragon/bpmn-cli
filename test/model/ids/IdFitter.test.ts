import { describe, expect, it } from 'vitest';
import { IdFitter } from '../../../src/model/ids/IdFitter.js';

describe('IdFitter', () => {
  it.each([
    [undefined, ['CheckInvoice', 'To', 'PayBill']],
    ['camel', ['checkInvoice', 'To', 'PayBill']],
    ['snake', ['check_invoice', '_to_', 'pay_bill']],
    ['kebab', ['check-invoice', '-to-', 'pay-bill']],
  ] as const)('writes the ends of a flow from "Check invoice" to "Pay bill" in the body case %s', (body, ends) => {
    const fitter = new IdFitter(body ? { body } : {});

    expect(fitter.ends('Check invoice', 'Pay bill')).toEqual(ends);
  });

  it('joins both ends whole when they fit the room', () => {
    const fitter = new IdFitter({ body: 'camel' });

    expect(fitter.pair('flow_', 'checkInvoice', 'To', 'PayBill', 64)).toBe('flow_checkInvoiceToPayBill');
  });

  it('drops words from both ends of a long flow until the id fits', () => {
    const fitter = new IdFitter({ body: 'camel' });
    const source = 'checkTheVeryLongInvoiceOfTheCustomerThoroughly';
    const target = 'PayTheVeryLongBillOfTheCustomerThoroughly';

    expect(fitter.pair('flow_', source, 'To', target, 40)).toBe('flow_checkTheVeryLongInvoiceToPayTheVery');
    expect(fitter.pair('flow_', source, 'To', target, 20)).toBe('flow_checkToPay');
  });

  it('keeps the join and the first letter of each end when there is no room for the head', () => {
    const fitter = new IdFitter({ body: 'camel' });

    expect(fitter.pair('flow_', 'check', 'To', 'pay', 2)).toBe('flow_To');
  });

  it('shortens ends that begin alike and cuts snake_case ends inside their words', () => {
    const pascal = new IdFitter({ body: 'pascal' });
    const snake = new IdFitter({ body: 'snake' });

    expect(pascal.pair('Flow_', 'Reviewer', 'To', 'ReviewerAssistantOfTheDepartment', 25)).toBe('Flow_ReviewerToDepartment');
    expect(snake.pair('flow_', 'check_the_very_long_invoice_of_customer', '_to_', 'pay_the_very_long_bill_of_customer', 40)).toBe('flow_check_the_very_to_pay_the_very_long');
  });

  it('keeps a number that closes the source end instead of cutting it off', () => {
    const fitter = new IdFitter({ body: 'pascal' });

    expect(fitter.pair('Flow_', 'CheckInvoiceAndSendMailToCustomer2', 'To', 'PayInvoiceAndWaitForTheCustomerToConfirm', 40)).toBe('Flow_CheckInvoice2ToPayInvoiceAndWait');
  });
});
