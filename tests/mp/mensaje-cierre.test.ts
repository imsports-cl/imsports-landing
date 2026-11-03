import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaMensaje, mensajeCierre, mensajeCierreBloqueado, type CupoAsegurado } from '../../lib/cierre/mensaje';
import { CUPOS_2NOV, TITULARES_2NOV } from './fixtures/cierre-2nov';

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
  const texto = mensajeCierre({ titulares, cupos, futuros: FUTUROS, fechaPartido: '2026-09-28' });
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

test('2-nov sin pichangas futuras: hasta directo, y el que no pagó no asegura', () => {
  const texto = mensajeCierre({
    titulares: TITULARES_2NOV,
    cupos: CUPOS_2NOV,
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
    'Boris, Chalo',
  ].join('\n'));
});

test('nadie impago: la línea es Nadie y el encabezado queda', () => {
  const texto = mensajeCierre({
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
  const texto = mensajeCierre({
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
  const texto = mensajeCierre({
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

test('las fechas salen de menor a mayor y un hasta entre dos pichangas cae en la anterior', () => {
  const texto = mensajeCierre({
    titulares: [
      { user_id: 'u-z', nombre: 'Zeta', estado: 'pagado' },
      { user_id: 'u-a', nombre: 'Alan', estado: 'pagado' },
    ],
    cupos: [
      { user_id: 'u-z', nombre: 'Zeta', hasta: '2026-10-19' },
      { user_id: 'u-a', nombre: 'Alan', hasta: '2026-10-07' },
    ],
    futuros: [{ fecha: '2026-10-19' }, { fecha: '2026-10-05' }, { fecha: '2026-10-12' }],
    fechaPartido: '2026-09-28',
  });
  const cuerpo = texto.split('Asegura cupo hasta:\n')[1];
  assert.equal(cuerpo, '5 de octubre\nAlan\n19 de octubre\nZeta');
});

test('quien solo asegura la pichanga que se cierra no entra', () => {
  const texto = mensajeCierre({
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
