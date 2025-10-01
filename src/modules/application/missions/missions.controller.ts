import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MissionsService } from './missions.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { AcceptMissionDto } from './dto/accept-mission.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@ApiTags('missions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('missions')
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  @ApiOperation({ summary: 'Create a new mission' })
  @ApiResponse({ status: 201, description: 'Mission created successfully' })
  @Post()
  async createMission(@Body() createMissionDto: CreateMissionDto, @Req() req: Request) {
    const userId = (req as any).user.id;
    const userType = (req as any).user.type;

    // Debug logging
    console.log('JWT User Info:', {
      id: userId,
      type: userType,
      fullUser: (req as any).user
    });

    // Only shippers can create missions
    if (userType !== 'shipper') {
      return {
        success: false,
        message: `Only shippers can create missions. Current user type: ${userType}`,
      };
    }

    return this.missionsService.createMission(createMissionDto, userId);
  }

  @ApiOperation({ summary: 'Get available missions for carriers' })
  @ApiResponse({ status: 200, description: 'Available missions retrieved successfully' })
  @Get('available')
  async getAvailableMissions(@Req() req: Request) {
    const userId = (req as any).user.id;
    const userType = (req as any).user.type;

    // Only carriers can see available missions
    if (userType !== 'carrier') {
      return {
        success: false,
        message: 'Only carriers can view available missions',
      };
    }

    return this.missionsService.getAvailableMissions(userId);
  }

  @ApiOperation({ summary: 'Get user missions' })
  @ApiResponse({ status: 200, description: 'User missions retrieved successfully' })
  @Get('my-missions')
  async getMyMissions(@Req() req: Request) {
    const userId = (req as any).user.id;
    const userType = (req as any).user.type;

    return this.missionsService.getMyMissions(userId, userType);
  }

  @ApiOperation({ summary: 'Accept a mission' })
  @ApiResponse({ status: 200, description: 'Mission accepted successfully' })
  @Post(':id/accept')
  async acceptMission(
    @Param('id') missionId: string,
    @Body() acceptMissionDto: AcceptMissionDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id;
    const userType = (req as any).user.type;

    // Only carriers can accept missions
    if (userType !== 'carrier') {
      return {
        success: false,
        message: 'Only carriers can accept missions',
      };
    }

    return this.missionsService.acceptMission(missionId, userId, acceptMissionDto);
  }

  @ApiOperation({ summary: 'Get mission by ID' })
  @ApiResponse({ status: 200, description: 'Mission retrieved successfully' })
  @Get(':id')
  async getMissionById(@Param('id') missionId: string) {
    return this.missionsService.getMissionById(missionId);
  }

  @ApiOperation({ summary: 'Confirm payment for mission (Testing endpoint)' })
  @ApiResponse({ status: 200, description: 'Payment confirmed successfully' })
  @Post(':id/confirm-payment')
  async confirmPayment(@Param('id') missionId: string, @Req() req: Request) {
    const userId = (req as any).user.id;
    const userType = (req as any).user.type;

    // Only shippers can confirm payment for their missions
    if (userType !== 'shipper') {
      return {
        success: false,
        message: 'Only shippers can confirm payment',
      };
    }

    return this.missionsService.confirmPayment(missionId);
  }
}
