const Vec3 = require('vec3').Vec3

module.exports.server = function (serv, { version }) {
  const mcData = require('minecraft-data')(version)

  const redstoneWireType = mcData.blocksByName.redstone_wire.id
  const redstoneTorchType = mcData.blocksByName.redstone_torch.id
  const unlitRedstoneTorchType = mcData.blocksByName.unlit_redstone_torch.id
  // const poweredRepeaterType = mcData.blocksByName.powered_repeater.id
  const unpoweredRepeaterType = mcData.blocksByName.unpowered_repeater.id

  const powerLevel = (block) => {
    if (block.type === redstoneWireType) return block.metadata
    if (block.type === redstoneTorchType) return 15
    return 0
  }

  const isWireDirectedIn = async (world, pos, dir) => {
    const up = await world.getBlock(pos.offset(0, 1, 0))
    const upSolid = isSolid(up)
    const b1 = (await wireDirection(world, pos.offset(-dir.x, 0, -dir.z), upSolid)).block !== null
    const b2 = (await wireDirection(world, pos.offset(dir.z, 0, dir.x), upSolid)).block !== null
    const b3 = (await wireDirection(world, pos.offset(-dir.z, 0, -dir.x), upSolid)).block !== null
    return b1 && !(b2 || b3)
  }

  // Return the power level from the block at pos to the solid block in dir
  const powerLevelDir = async (world, pos, dir) => {
    const block = await world.getBlock(pos)
    if (dir.y === 1 && block.type === redstoneTorchType) return 15
    if (block.type === redstoneWireType) {
      if (dir.y === -1 || await isWireDirectedIn(world, pos, dir)) { return block.metadata }
    }
    return 0
  }

  const isSolid = (block) => {
    return block.boundingBox === 'block'
  }

  const isWire = (block) => {
    return block.type === redstoneWireType
  }

  const isRedstone = (block) => {
    return block.type === redstoneWireType || block.type === redstoneTorchType || block.type === unlitRedstoneTorchType
  }

  const wireDirection = async (world, pos, upSolid) => {
    const blockA = await world.getBlock(pos)
    blockA.position = pos
    const blockB = await world.getBlock(pos.offset(0, -1, 0))
    blockB.position = pos.offset(0, -1, 0)
    const blockC = await world.getBlock(pos.offset(0, 1, 0))
    blockC.position = pos.offset(0, 1, 0)
    if (isRedstone(blockA)) { // same y
      return { power: powerLevel(blockA), block: blockA }
    }
    if (!isSolid(blockA) && isWire(blockB)) { // down
      return { power: powerLevel(blockB), block: blockB }
    }
    if (!upSolid && isWire(blockC)) { // up
      return { power: powerLevel(blockC), block: blockC }
    }
    return { power: 0, block: null }
  }

  const notifyEndOfLine = async (world, pos, dir, tick) => {
    const blockPos = pos.plus(dir)
    const block = await world.getBlock(blockPos)
    if (isSolid(block) && await isWireDirectedIn(world, pos, dir)) {
      serv.updateBlock(world, blockPos, tick)
      serv.notifyNeighborsOfStateChangeDirectional(world, pos, dir, tick)
    }
  }

  serv.on('asap', () => {
    serv.onItemPlace('redstone', () => {
      return { id: redstoneWireType, data: 0 }
    })

    serv.onItemPlace('redstone_torch', ({ direction }) => {
      const directionToData = [0, 5, 4, 3, 2, 1]
      // Placing an unlit torch allows to detect change on the first update
      // and reduce the block updates
      return { id: unlitRedstoneTorchType, data: directionToData[direction] }
    })

    serv.onItemPlace('repeater', ({ angle }) => {
      return { id: unpoweredRepeaterType, data: Math.floor(angle / 90 + 0.5) & 0x3 }
    })

    const torchDataToOffset = [null, new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(0, -1, 0)]

    const updateRedstoneTorch = async (world, block, tick) => {
      const offset = torchDataToOffset[block.metadata]
      const pos = block.position

      // Redstone torch should be attached to a solid block
      const support = await world.getBlock(pos.plus(offset))
      support.position = pos.plus(offset)
      if (support.boundingBox !== 'block') {
        await world.setBlockType(pos, 0)
        await world.setBlockData(pos, 0)
        // TODO: drop torch
        serv.notifyNeighborsOfStateChange(world, pos, tick, true)
        return true
      }

      let p = await powerLevelDir(world, support.position.offset(0, -1, 0), new Vec3(0, 1, 0))
      if (block.metadata !== 1) p = Math.max(p, await powerLevelDir(world, support.position.offset(1, 0, 0), new Vec3(-1, 0, 0)))
      if (block.metadata !== 2) p = Math.max(p, await powerLevelDir(world, support.position.offset(-1, 0, 0), new Vec3(1, 0, 0)))
      if (block.metadata !== 3) p = Math.max(p, await powerLevelDir(world, support.position.offset(0, 0, 1), new Vec3(0, 0, -1)))
      if (block.metadata !== 4) p = Math.max(p, await powerLevelDir(world, support.position.offset(0, 0, -1), new Vec3(0, 0, 1)))
      if (block.metadata !== 5) p = Math.max(p, await powerLevelDir(world, support.position.offset(0, 1, 0), new Vec3(0, -1, 0)))

      let changed = false
      if (block.type === redstoneTorchType && p !== 0) {
        await world.setBlockType(pos, unlitRedstoneTorchType)
        changed = true
      } else if (block.type === unlitRedstoneTorchType && p === 0) {
        await world.setBlockType(pos, redstoneTorchType)
        changed = true
      }

      if (changed) {
        if (block.metadata === 1) serv.notifyNeighborsOfStateChangeDirectional(world, pos.offset(-1, 0, 0), new Vec3(1, 0, 0), tick + 1)
        if (block.metadata === 2) serv.notifyNeighborsOfStateChangeDirectional(world, pos.offset(1, 0, 0), new Vec3(-1, 0, 0), tick + 1)
        if (block.metadata === 3) serv.notifyNeighborsOfStateChangeDirectional(world, pos.offset(0, 0, -1), new Vec3(0, 0, 1), tick + 1)
        if (block.metadata === 4) serv.notifyNeighborsOfStateChangeDirectional(world, pos.offset(0, 0, 1), new Vec3(0, 0, -1), tick + 1)
        if (block.metadata === 5) serv.notifyNeighborsOfStateChangeDirectional(world, pos.offset(0, -1, 0), new Vec3(0, 1, 0), tick + 1)
        if (isSolid(await world.getBlock(pos.offset(0, 1, 0)))) { serv.notifyNeighborsOfStateChangeDirectional(world, pos, new Vec3(0, 1, 0), tick + 1) }
      }

      return changed
    }
    serv.onBlockUpdate('redstone_torch', updateRedstoneTorch)
    serv.onBlockUpdate('unlit_redstone_torch', updateRedstoneTorch)

    serv.onBlockUpdate('redstone_wire', async (world, block, tick) => {
      const pos = block.position

      // Redstone wire should be on a solid block
      const support = await world.getBlock(pos.offset(0, -1, 0))
      if (support.boundingBox !== 'block') {
        await world.setBlockType(pos, 0)
        await world.setBlockData(pos, 0)
        // TODO: drop redstone
        serv.notifyNeighborsOfStateChange(world, pos, tick)
        return true
      }

      const up = await world.getBlock(pos.offset(0, 1, 0))
      const upSolid = isSolid(up)

      const b1 = await wireDirection(world, pos.offset(-1, 0, 0), upSolid)
      const b2 = await wireDirection(world, pos.offset(1, 0, 0), upSolid)
      const b3 = await wireDirection(world, pos.offset(0, 0, -1), upSolid)
      const b4 = await wireDirection(world, pos.offset(0, 0, 1), upSolid)

      const maxPower = Math.max(Math.max(b1.power, b2.power), Math.max(b3.power, b4.power))
      const curPower = block.metadata
      const newPower = Math.max(0, maxPower - 1)
      const changed = curPower !== newPower

      if (changed) {
        // The power level has changed we update the block state
        await world.setBlockData(pos, newPower)

        // Redstone wires neighbors:
        if (b1.block) serv.updateBlock(world, b1.block.position, tick)
        if (b2.block) serv.updateBlock(world, b2.block.position, tick)
        if (b3.block) serv.updateBlock(world, b3.block.position, tick)
        if (b4.block) serv.updateBlock(world, b4.block.position, tick)

        // Block updates
        // Only update if there is a real state change (powered / not powered)
        if ((curPower === 0) !== (newPower === 0)) {
          serv.updateBlock(world, pos.offset(0, -1, 0), tick)
          serv.notifyNeighborsOfStateChangeDirectional(world, pos, new Vec3(0, -1, 0), tick)
        }
      }

      // The end of line updates are always triggered because the direction is not encoded in the state
      // (so we cannot detect the change)
      await notifyEndOfLine(world, pos, new Vec3(1, 0, 0), tick + 1)
      await notifyEndOfLine(world, pos, new Vec3(-1, 0, 0), tick + 1)
      await notifyEndOfLine(world, pos, new Vec3(0, 0, 1), tick + 1)
      await notifyEndOfLine(world, pos, new Vec3(0, 0, -1), tick + 1)

      return changed
    })
  })
}
