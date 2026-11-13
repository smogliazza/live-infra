import { describe, expect, it } from 'vitest';
import { comparisonAspects } from '../../src/catalog/comparison';
import { providers } from '../../src/catalog';
import { useSim } from '../../src/ui/state/store';

function runFor(ms: number) {
  // tick limita cada paso a 100 ms reales; 1 ms real = 0.01 ms virtuales a 1×.
  for (let t = 0; t < ms; t += 100) useSim.getState().tick(100);
}

describe('modo comparación', () => {
  it('ambos motores reciben los mismos comandos en el mismo instante', () => {
    const s = useSim.getState();
    s.setScenario('aws', 'aws-eks-shop');
    s.setCompare('azure');
    s.setSpeed(25);
    s.play();
    s.dispatch({ type: 'toggleFault', faultId: 'lb-no-healthy-targets', enabled: true });
    s.dispatch({ type: 'startRequest' });
    runFor(2000);
    const { engine, compareEngine } = useSim.getState();
    expect(compareEngine).toBeDefined();
    expect(compareEngine!.now).toBe(engine.now);
    expect(compareEngine!.commands.map((c) => [c.at, c.command])).toEqual(engine.commands.map((c) => [c.at, c.command]));
    const status = (e: typeof engine) => e.log.find((ev) => ev.type === 'request.completed')?.payload.status;
    // Misma intención, misma avería, comportamiento real distinto por proveedor.
    expect(status(engine)).toBe(503);
    expect(status(compareEngine!)).toBe(502);
  });

  it('desactivar la comparación deja un único motor', () => {
    useSim.getState().setCompare(undefined);
    expect(useSim.getState().compareEngine).toBeUndefined();
  });

  it('cada aspecto tiene notas para todos los perfiles registrados', () => {
    for (const a of comparisonAspects) {
      for (const p of providers) expect(a.notes[p.id], `${a.id}/${p.id}`).toBeTruthy();
    }
  });
});
