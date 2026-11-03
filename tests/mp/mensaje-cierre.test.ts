import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaMensaje, mensajeCierre, mensajeCierreBloqueado, type CupoAsegurado } from '../../lib/cierre/mensaje';
import { BANCA_2NOV, CUPOS_2NOV, TITULARES_2NOV } from './fixtures/cierre-2nov';

const textoDe = (input: Parameters<typeof mensajeCierre>[0]) => mensajeCierre(input).texto;

const FUTUROS = [
  { fecha: '2026-10-05' },
  { fecha: '2026-10-12' },
  { fecha: '2026-10-19' },
];

test('formato: pierde cupo y asegura, agrupado por la última fecha', () => {
  const cupos: CupoAsegurado[] = [
    { user_id: 'u-benja', nombre: 'Benja', hasta: '2026-10-05' },
    { user_id: 'u-esteban', nombre: 'Esteban', hasta: '2026-10-05' },
    { user_id: 'u-roberto', nombre: 'Roberto', hasta: '2026-10-12' },
    { user_id: 'u-chino', nombre: 'Chino', hasta: '2026-10-12' },
    { user_id: 'u-robert', nombre: 'Robert', hasta: '2026-10-12' },
    { user_id: 'u-villa', nombre: 'Villa', hasta: '2026-10-12' },
    { user_id: 'u-chipi', nombre: 'Chipi', hasta: '2026-10-12' },
    { user_id: 'u-chalo', nombre: 'Chalo', hasta: '2026-10-12' },
    { user_id: 'u-gs', nombre: 'Gonzalo Serrano', hasta: '2026-10-12' },
    { user_id: 'u-jorge', nombre: 'Jorge', hasta: '2026-10-19' },
    { user_id: 'u-mi', nombre: 'Morales Ibáñez', hasta: '2026-10-19' },
    { user_id: 'u-fantasma', nombre: 'Fantasma', hasta: '2026-10-19' },
  ];
  const titulares = [
    { user_id: 'u-luis', nombre: 'Luis', estado: 'no_pagado' as const },
    { user_id: 'u-pablo', nombre: 'Pablo', estado: 'pagado_tarde' as const },
    { user_id: 'u-benja', nombre: 'Benja', estado: 'pagado' as const },
    { user_id: 'u-esteban', nombre: 'Esteban', estado: 'pagado' as const },
  ];
  const texto = textoDe({ titulares, cupos, futuros: FUTUROS, fechaPartido: '2026-09-28' });
  assert.equal(texto, [
    'Pierde cupo por no pago:',
    'Luis, Pablo',
    '',
    'Asegura cupo hasta:',
    '5 de octubre',
    'Benja, Esteban',
    '12 de octubre',
    'Roberto, Chino, Robert, Villa, Chipi, Chalo, Gonzalo Serrano',
    '19 de octubre',
    'Jorge, Morales Ibáñez, Fantasma',
  ].join('\n'));
});

test('2-nov: pierde cupo, cupos vigentes y banca nueva al +28', () => {
  const texto = textoDe({
    titulares: TITULARES_2NOV,
    cupos: CUPOS_2NOV,
    banca: BANCA_2NOV,
    futuros: [],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto, [
    'Pierde cupo por no pago:',
    'Chino, Chipi, Esteban, Gonzalo',
    '',
    'Asegura cupo hasta:',
    '9 de noviembre',
    'Talo',
    '16 de noviembre',
    'Boris',
    '30 de noviembre',
    'Michel, Villa, Roberto',
  ].join('\n'));
});

test('nadie impago: la línea es Nadie y el encabezado queda', () => {
  const texto = textoDe({
    titulares: [{ nombre: 'Alan', estado: 'pagado' }],
    cupos: [],
    futuros: FUTUROS,
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto, [
    'Pierde cupo por no pago:',
    'Nadie',
    '',
    'Asegura cupo hasta:',
    'Nadie',
  ].join('\n'));
});

test('sin pichangas futuras: se usa la fecha hasta', () => {
  const texto = textoDe({
    titulares: [],
    cupos: [{ user_id: 'u-benja', nombre: 'Benja', hasta: '2026-12-01' }],
    futuros: [],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto.endsWith('Asegura cupo hasta:\n1 de diciembre\nBenja'), true);
});

test('23:30 CLT sigue en el día de Chile; matches.date 00:00Z no se corre', () => {
  // 6-oct 02:30Z = 5-oct 23:30 CLT (UTC-3).
  assert.equal(fechaMensaje('2026-10-06T02:30:00.000Z'), '5 de octubre');
  assert.equal(fechaMensaje('2026-10-05T00:00:00.000Z'), '5 de octubre');
  assert.equal(fechaMensaje('2026-10-05'), '5 de octubre');
});

test('un jugador con dos cupos sale una sola vez, en la última fecha', () => {
  const texto = textoDe({
    titulares: [],
    cupos: [
      { user_id: 'u-jorge', nombre: 'Jorge', hasta: '2026-10-05' },
      { user_id: 'u-jorge', nombre: 'Jorge', hasta: '2026-10-19' },
    ],
    futuros: FUTUROS,
    fechaPartido: '2026-09-28',
  });
  assert.equal(texto.split('Jorge').length - 1, 1);
  assert.match(texto, /19 de octubre\nJorge$/);
  assert.equal(texto.includes('5 de octubre'), false);
});

test('las fechas salen de menor a mayor, por el hasta y no por un partido', () => {
  const texto = textoDe({
    titulares: [
      { user_id: 'u-z', nombre: 'Zeta', estado: 'pagado' },
      { user_id: 'u-a', nombre: 'Alan', estado: 'pagado' },
    ],
    cupos: [
      { user_id: 'u-z', nombre: 'Zeta', hasta: '2026-10-19' },
      { user_id: 'u-a', nombre: 'Alan', hasta: '2026-10-07' },
      { user_id: 'u-a', nombre: 'Alan', hasta: '2026-10-05' },
    ],
    fechaPartido: '2026-09-28',
  });
  const cuerpo = texto.split('Asegura cupo hasta:\n')[1];
  assert.equal(cuerpo, '7 de octubre\nAlan\n19 de octubre\nZeta');
});

test('banca nueva suma 28 días; la que ya tenía cupo automático no', () => {
  const r = mensajeCierre({
    titulares: [{ user_id: 'u-talo', nombre: 'Talo', estado: 'pagado' }],
    cupos: [{ user_id: 'u-chalo', nombre: 'Chalo', hasta: '2026-11-16' }],
    banca: [
      { user_id: 'u-chalo', nombre: 'Chalo', responded_at: '2026-11-01T12:00:00Z' },
      { user_id: 'u-michel', nombre: 'Michel', responded_at: '2026-11-01T13:00:00Z' },
    ],
    fechaPartido: '2026-11-02',
  });
  assert.equal(r.texto.includes('Chalo'), false);
  assert.match(r.texto, /30 de noviembre\nMichel$/);
  assert.equal(r.bloqueo, null);
});

test('cupo manual no se pierde en la banca; el impago sí lo pierde', () => {
  const texto = textoDe({
    titulares: [
      { user_id: 'u-esteban', nombre: 'Esteban', estado: 'no_pagado' },
      { user_id: 'u-alan', nombre: 'Alan', estado: 'pagado' },
    ],
    cupos: [
      { user_id: 'u-villa', nombre: 'Villa', hasta: '2026-11-16', manual: true },
      { user_id: 'u-esteban', nombre: 'Esteban', hasta: '2026-12-01', manual: true },
    ],
    banca: [
      { user_id: 'u-villa', nombre: 'Villa', responded_at: '2026-11-01T10:00:00Z' },
      { user_id: 'u-michel', nombre: 'Michel', responded_at: '2026-11-01T11:00:00Z' },
    ],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto.includes('Esteban'), true);
  assert.match(texto, /Pierde cupo por no pago:\nEsteban/);
  assert.equal(texto.includes('1 de diciembre'), false);
  assert.match(texto, /16 de noviembre\nVilla/);
  assert.match(texto, /30 de noviembre\nMichel/);
  assert.equal(texto.includes('Villa') && texto.split('Villa').length === 2, true);
});

test('organizador de un partido no entra ni gana 28 días', () => {
  const texto = textoDe({
    titulares: [],
    cupos: [{ user_id: 'u-barham', nombre: 'Barham', hasta: '2026-11-02', es_organizador: true }],
    banca: [{ user_id: 'u-barham', nombre: 'Barham', responded_at: '2026-11-01T09:00:00Z' }],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto.includes('Barham'), false);
  assert.match(texto, /Asegura cupo hasta:\nNadie$/);
});

test('confirmo tarde no es banca que asegura', () => {
  const texto = textoDe({
    titulares: [],
    cupos: [],
    banca: [{ user_id: 'u-x', nombre: 'Xime', responded_at: '2026-11-02T18:00:00Z', confirmo_tarde: true }],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto.includes('Xime'), false);
});

test('solape no entra en pierde y bloquea el copiado', () => {
  const r = mensajeCierre({
    titulares: [
      { user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado', solape: true },
      { user_id: 'u-chipi', nombre: 'Chipi', estado: 'no_pagado' },
    ],
    cupos: [],
    fechaPartido: '2026-11-02',
  });
  assert.match(r.texto, /Pierde cupo por no pago:\nChipi\n/);
  assert.equal(r.texto.includes('Chino'), false);
  assert.equal(r.bloqueo, 'sin_certeza');
  assert.equal(r.bloqueado, true);
});

test('sin Mercado Pago no lista a todos como impagos', () => {
  const r = mensajeCierre({
    titulares: [
      { user_id: 'u-alan', nombre: 'Alan', estado: 'no_pagado' },
      { user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado' },
    ],
    cupos: [],
    fechaPartido: '2026-11-02',
    configurado: false,
  });
  assert.match(r.texto, /Pierde cupo por no pago:\n\nAsegura cupo hasta:\nNadie$/);
  assert.equal(r.bloqueo, 'mp_no_configurado');
});

test('cupos no disponibles no dice Nadie', () => {
  const r = mensajeCierre({
    titulares: [{ user_id: 'u-alan', nombre: 'Alan', estado: 'pagado' }],
    cupos: [],
    fechaPartido: '2026-11-02',
    cuposDisponibles: false,
  });
  assert.match(r.texto, /Pierde cupo por no pago:\nNadie\n/);
  assert.equal(r.texto.endsWith('Asegura cupo hasta:'), true);
  assert.equal(r.bloqueo, 'cupos_no_disponibles');
});

test('historial incompleto no dice Nadie', () => {
  const r = mensajeCierre({
    titulares: [{ user_id: 'u-chino', nombre: 'Chino', estado: 'no_pagado' }],
    cupos: [],
    fechaPartido: '2026-11-02',
    historialIncompleto: true,
  });
  assert.match(r.texto, /Pierde cupo por no pago:\n\nAsegura cupo hasta:\nNadie$/);
  assert.equal(r.bloqueo, 'historial_incompleto');
});

test('quien solo asegura la pichanga que se cierra no entra', () => {
  const texto = textoDe({
    titulares: [{ user_id: 'u-alan', nombre: 'Alan', estado: 'pagado' }],
    cupos: [{ user_id: 'u-alan', nombre: 'Alan', hasta: '2026-11-02' }],
    futuros: [{ fecha: '2026-11-09' }],
    fechaPartido: '2026-11-02',
  });
  assert.equal(texto.includes('Alan'), false);
});

test('historial incompleto o MP incompleto bloquean el copiado', () => {
  assert.equal(mensajeCierreBloqueado({}), false);
  assert.equal(mensajeCierreBloqueado({ historial_incompleto: true }), true);
  assert.equal(mensajeCierreBloqueado({ mp_incompleto: true }), true);
});
