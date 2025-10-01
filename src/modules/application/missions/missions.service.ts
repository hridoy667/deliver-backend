import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMissionDto, ShipmentType } from './dto/create-mission.dto';
import { MissionStatus } from '@prisma/client';
import { AcceptMissionDto } from './dto/accept-mission.dto';

@Injectable()
export class MissionsService {
  constructor(private prisma: PrismaService) {}

  async createMission(createMissionDto: CreateMissionDto, shipperId: string) {
    try {
      // Calculate distance if not provided
      let distance = createMissionDto.distance_km;
      if (!distance) {
        distance = await this.calculateDistance(
          createMissionDto.loading_address,
          createMissionDto.delivery_address
        );
      }

      // Calculate pricing
      const pricing = this.calculatePricing(distance, createMissionDto.shipment_type);
      
      // Calculate volume if not provided
      let volume = createMissionDto.volume_m3;
      if (!volume && createMissionDto.length_m && createMissionDto.width_m && createMissionDto.height_m) {
        volume = createMissionDto.length_m * createMissionDto.width_m * createMissionDto.height_m;
      }

      // Create mission
      const mission = await this.prisma.mission.create({
        data: {
          // Address Information
          pickup_address: `${createMissionDto.loading_address}, ${createMissionDto.loading_city} ${createMissionDto.loading_postal_code}`,
          delivery_address: `${createMissionDto.delivery_address}, ${createMissionDto.delivery_city} ${createMissionDto.delivery_postal_code}`,
          
          // Goods Information
          goods_type: createMissionDto.goods_type,
          parcels_count: 1, // Default to 1, can be calculated based on dimensions
          weight_kg: createMissionDto.weight_kg,
          volume_m3: volume || 0,
          special_instructions: createMissionDto.loading_instructions || createMissionDto.delivery_instructions,
          fragile: createMissionDto.fragile || false,
          
          // Timing
          pickup_date: new Date(createMissionDto.loading_date),
          time_slot: createMissionDto.loading_time,
          
          // Pricing
          distance_km: distance,
          base_price: pricing.basePrice,
          final_price: pricing.finalPrice,
          commission_rate: 0.10, // 10% commission
          commission_amount: pricing.commissionAmount,
          
          // Status
          status: MissionStatus.CREATED,
          
          // Relations
          shipper_id: shipperId,
        },
      });

      return {
        success: true,
        message: 'Mission created successfully',
        data: mission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getAvailableMissions(carrierId: string) {
    try {
      const missions = await this.prisma.mission.findMany({
        where: {
          status: {
            in: [MissionStatus.SEARCHING_CARRIER, MissionStatus.CREATED] // Allow both for testing
          },
          carrier_id: null,
        },
        include: {
          shipper: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
              total_reviews: true,
              completed_missions: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      return {
        success: true,
        data: missions,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getMyMissions(userId: string, userType: string) {
    try {
      const whereClause = userType === 'shipper' 
        ? { shipper_id: userId }
        : { carrier_id: userId };

      const missions = await this.prisma.mission.findMany({
        where: whereClause,
        include: {
          shipper: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
            },
          },
          carrier: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      return {
        success: true,
        data: missions,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async acceptMission(missionId: string, carrierId: string, acceptMissionDto: AcceptMissionDto) {
    try {
      // Check if mission exists and is available
      const mission = await this.prisma.mission.findUnique({
        where: { id: missionId },
      });

      if (!mission) {
        throw new NotFoundException('Mission not found');
      }

      if (mission.status !== MissionStatus.SEARCHING_CARRIER && mission.status !== MissionStatus.CREATED) {
        throw new BadRequestException('Mission is not available for acceptance');
      }

      if (mission.carrier_id) {
        throw new BadRequestException('Mission has already been accepted');
      }

      // Update mission status
      const updatedMission = await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          carrier_id: carrierId,
          status: MissionStatus.ACCEPTED,
        },
        include: {
          shipper: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          carrier: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // TODO: Send notification to shipper about mission acceptance

      return {
        success: true,
        message: 'Mission accepted successfully',
        data: updatedMission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getMissionById(missionId: string) {
    try {
      const mission = await this.prisma.mission.findUnique({
        where: { id: missionId },
        include: {
          shipper: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
              total_reviews: true,
              completed_missions: true,
            },
          },
          carrier: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
              total_reviews: true,
              completed_missions: true,
            },
          },
          tracking_points: {
            orderBy: {
              created_at: 'asc',
            },
          },
        },
      });

      if (!mission) {
        throw new NotFoundException('Mission not found');
      }

      return {
        success: true,
        data: mission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  private calculatePricing(distance: number, shipmentType: ShipmentType) {
    // Base pricing per km
    const baseRatePerKm = shipmentType === ShipmentType.EXPRESS ? 1.20 : 0.70; // Express +30%
    
    const basePrice = distance * baseRatePerKm;
    const commissionRate = 0.10; // 10%
    const commissionAmount = basePrice * commissionRate;
    const finalPrice = basePrice + commissionAmount;

    return {
      basePrice: Math.round(basePrice * 100) / 100,
      finalPrice: Math.round(finalPrice * 100) / 100,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
    };
  }

  async updateMissionStatus(missionId: string, status: MissionStatus) {
    try {
      const mission = await this.prisma.mission.update({
        where: { id: missionId },
        data: { status },
      });

      return {
        success: true,
        message: 'Mission status updated successfully',
        data: mission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // Temporary method for testing - simulate payment confirmation
  async confirmPayment(missionId: string) {
    return this.updateMissionStatus(missionId, MissionStatus.SEARCHING_CARRIER);
  }

  private async calculateDistance(pickupAddress: string, deliveryAddress: string): Promise<number> {
    // TODO: Implement actual distance calculation using Google Maps API or similar
    // For now, return a mock distance
    return Math.random() * 100 + 10; // Random distance between 10-110 km
  }
}
