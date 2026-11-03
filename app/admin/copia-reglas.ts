/**
 * Textos de ayuda de /admin (titulares). Con el flag apagado son los de prod.
 * Los de «4 fechas / 28 días» no viven acá: en la página quedan los de prod, con el flag apagado o encendido.
 */
export interface Fragmento {
  texto: string;
  fuerte?: boolean;
}

export interface CopiaReglasAdmin {
  /** Vacío con el flag apagado. */
  cuposExtra: string;
  introPierde: Fragmento[];
  tituloPierde: string;
  reglasPierde: Fragmento[][];
  neteo: Fragmento[];
}

const FINAL_LISTA: Fragmento[] = [
  { texto: 'Queda al ' },
  { texto: 'final de la lista y sin puntos', fuerte: true },
  { texto: '; entre sancionados ordena la hora de confirmación.' },
];

const SOBRA: Fragmento[] = [
  { texto: 'Si igual sobra cupo, juega: solo baja de prioridad.' },
];

const NETEO_BASE: Fragmento[] = [
  { texto: 'Si alguien ' },
  { texto: 'asegura cupo y lo pierde', fuerte: true },
  { texto: ' en la misma fecha, se anulan: entra por la regla de puntajes, conservando sus confirmaciones.' },
];

export function copiaReglasAdmin(activa: boolean): CopiaReglasAdmin {
  if (!activa) {
    return {
      cuposExtra: '',
      introPierde: [{
        texto: 'Por no pagar a tiempo o llegar tarde. Quedan al final de la lista (sin puntos) y entre ellos ordena la hora de confirmación. Si hay cupo igual juegan. Dura solo esta fecha.',
      }],
      tituloPierde: '⛔ Pierde cupo (dura una fecha)',
      reglasPierde: [
        [{ texto: '💸 No pagó a tiempo · ⏰ Llegó tarde · 🚪 Se bajó pasadas las 13:00.' }],
        FINAL_LISTA,
        SOBRA,
      ],
      neteo: NETEO_BASE,
    };
  }
  return {
    cuposExtra: 'Quien debe una pichanga mantiene la fecha, pero mientras no pague su cupo se netea.',
    introPierde: [
      { texto: 'Por no pagar a tiempo, llegar tarde o bajarse pasadas las 13:00. Quedan al final de la lista (sin puntos) y entre ellos ordena la hora de confirmación. Si hay cupo igual juegan. Llegar tarde y bajarse tarde duran solo esta fecha. ' },
      { texto: 'No pagar suma 1 fecha por pichanga y se acumulan', fuerte: true },
      { texto: ': esas fechas se cumplen igual aunque pague. Si no paga, después de cumplirlas sigue sancionado hasta que pague. ' },
      { texto: '“Marcar pagado”', fuerte: true },
      { texto: ' salda la deuda y no borra las fechas pendientes.' },
    ],
    tituloPierde: '⛔ Pierde cupo',
    reglasPierde: [
      [
        { texto: '⏰ Llegó tarde · 🚪 Se bajó pasadas las 13:00 → ' },
        { texto: 'dura una fecha', fuerte: true },
        { texto: ' (la siguiente).' },
      ],
      [
        { texto: '💸 No pagó → cada pichanga impaga al cierre ' },
        { texto: 'suma 1 fecha de sanción y se acumulan', fuerte: true },
        { texto: '. Esas fechas se cumplen igual aunque pague. Si no paga, después de cumplirlas sigue sancionado hasta que pague. Pagar tarde no salva la fecha que ya se ganó.' },
      ],
      [
        { texto: 'Plazo para pagar:', fuerte: true },
        { texto: ' hasta que se cierre la pichanga. Mientras no se cierre, no es tarde; al cerrar, el que no ha pagado queda sancionado.' },
      ],
      [{ texto: 'La deuda se salda al conciliar el pago en Mercado Pago, o el admin la marca pagada (efectivo/transferencia). Eso no borra las fechas de sanción pendientes.' }],
      FINAL_LISTA,
      SOBRA,
    ],
    neteo: [
      ...NETEO_BASE,
      { texto: ' Con deuda activa o fechas de sanción pendientes esto pasa en ' },
      { texto: 'cada fecha mientras siga sancionado', fuerte: true },
      { texto: ' y con cualquier cupo (MVP, organizador o banca); el cupo no se pierde, sigue corriendo hasta su vencimiento.' },
    ],
  };
}

export function textoPlanoCopia(c: CopiaReglasAdmin): string {
  const t = (p: Fragmento[]) => p.map((x) => x.texto).join('');
  return [c.cuposExtra, t(c.introPierde), c.tituloPierde, ...c.reglasPierde.map(t), t(c.neteo)].join('\n');
}
