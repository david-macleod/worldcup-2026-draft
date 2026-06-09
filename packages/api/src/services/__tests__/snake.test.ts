import { describe, it, expect } from 'vitest'
import { pickToCell, seatForOverall, N_PICKS } from '../../lib/snake'

describe('snake seat math', () => {
  it('round 0 runs left-to-right, round 1 right-to-left', () => {
    expect(seatForOverall(0)).toBe(0)
    expect(seatForOverall(7)).toBe(7)
    expect(seatForOverall(8)).toBe(7) // snake turns
    expect(seatForOverall(15)).toBe(0)
    expect(seatForOverall(16)).toBe(0) // turns back
  })

  it('every seat gets exactly 6 picks across 48 overall picks', () => {
    const counts = new Array(8).fill(0)
    for (let o = 0; o < N_PICKS; o++) counts[seatForOverall(o)]++
    expect(counts).toEqual([6, 6, 6, 6, 6, 6, 6, 6])
  })

  it('pickToCell maps round and col', () => {
    expect(pickToCell(0)).toEqual({ round: 0, col: 0 })
    expect(pickToCell(8)).toEqual({ round: 1, col: 7 })
    expect(pickToCell(47)).toEqual({ round: 5, col: 0 })
  })
})
