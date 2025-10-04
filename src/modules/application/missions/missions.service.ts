import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { MissionStatus, ShipmentType } from '@prisma/client';
import { AcceptMissionDto } from './dto/accept-mission.dto';
import { SetPriceDto } from './dto/set-price.dto';
import { SelectCarrierDto } from './dto/select-carrier.dto';

@Injectable()
export class MissionsService {
  constructor(private prisma: PrismaService) {}

  async createMission(createMissionDto: CreateMissionDto, shipperId: string) {
    try {
      // Debug: Check if shipper exists
      
      const shipper = await this.prisma.user.findUnique({
        where: { id: shipperId },
        select: { id: true, name: true, type: true }
      });
      
      if (!shipper) {
        throw new BadRequestException(`Shipper with ID ${shipperId} not found`);
      }
      

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
          pickup_city: createMissionDto.loading_city,
          pickup_postal_code: createMissionDto.loading_postal_code,
          delivery_address: `${createMissionDto.delivery_address}, ${createMissionDto.delivery_city} ${createMissionDto.delivery_postal_code}`,
          delivery_city: createMissionDto.delivery_city,
          delivery_postal_code: createMissionDto.delivery_postal_code,
          
          // Contact Information
          pickup_contact_name: createMissionDto.loading_staff_name || 'Contact Name',
          pickup_contact_phone: createMissionDto.shipper_phone,
          delivery_contact_name: createMissionDto.recipient_name,
          delivery_contact_phone: createMissionDto.recipient_phone,
          
          // Shipment Details
          shipment_type: createMissionDto.shipment_type,
          temperature_required: createMissionDto.temperature_required,
          
          // Package Dimensions
          package_length: createMissionDto.length_m,
          package_width: createMissionDto.width_m,
          package_height: createMissionDto.height_m,
          
          // Delivery Timing
          delivery_date: createMissionDto.delivery_date ? new Date(createMissionDto.delivery_date) : null,
          delivery_time: createMissionDto.delivery_time,
          
          // Instructions
          pickup_instructions: createMissionDto.loading_instructions,
          delivery_instructions: createMissionDto.delivery_instructions,
          delivery_message: createMissionDto.delivery_message,
          
          // Goods Information
          goods_type: createMissionDto.goods_type,
          parcels_count: 1, // Default to 1, can be calculated based on dimensions
          weight_kg: createMissionDto.weight_kg,
          volume_m3: volume || 0,
          special_instructions: createMissionDto.loading_instructions || createMissionDto.delivery_instructions,
          fragile: createMissionDto.fragile || false,
          
          // Timing
          pickup_date: new Date(createMissionDto.loading_date),
          pickup_time: createMissionDto.loading_time,
          time_slot: createMissionDto.loading_time, // Temporary - will be removed after Prisma client regeneration
          
          // Pricing
          distance_km: distance,
          base_price: pricing.basePrice,
          final_price: pricing.finalPrice,
          commission_rate: 0.10, // 10% platform commission
          commission_amount: pricing.commissionAmount,
          vat_rate: 0.20, // 20% VAT
          
          // Status
          status: MissionStatus.CREATED,
          
          // Relations
          shipper: {
            connect: { id: shipperId }
          },
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
    const commissionRate = 0.10; // 10% platform commission
    const vatRate = 0.20; // 20% VAT
    
    // Calculate commission (platform charge)
    const commissionAmount = basePrice * commissionRate;
    
    // Calculate price including commission (before VAT)
    const priceWithCommission = basePrice + commissionAmount;
    
    // Calculate VAT on the total (base + commission)
    const vatAmount = priceWithCommission * vatRate;
    
    // Final price = base + commission + VAT
    const finalPrice = priceWithCommission + vatAmount;

    return {
      basePrice: Math.round(basePrice * 100) / 100,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      finalPrice: Math.round(finalPrice * 100) / 100,
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

  // ===== NEW ENHANCED MISSION FLOW METHODS =====

  async setMissionPrice(missionId: string, newPrice: number, shipperId: string) {
    try {
      const mission = await this.prisma.mission.findUnique({ where: { id: missionId } });
      if (!mission) throw new NotFoundException('Mission not found');
      if (mission.shipper_id !== shipperId) throw new BadRequestException('Only the mission creator can set the price');
      if (newPrice < mission.final_price) throw new BadRequestException('New price cannot be lower than the calculated price');

      const commissionRate = 0.10;
      const newBasePrice = newPrice / (1 + commissionRate);
      const newCommissionAmount = newPrice - newBasePrice;

      const updatedMission = await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          base_price: newBasePrice,
          final_price: newPrice,
          commission_amount: newCommissionAmount,
        },
      });

      return {
        success: true,
        message: 'Mission price updated successfully',
        data: updatedMission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async confirmMission(missionId: string, shipperId: string) {
    try {
      const mission = await this.prisma.mission.findUnique({ where: { id: missionId } });
      if (!mission) throw new NotFoundException('Mission not found');
      if (mission.shipper_id !== shipperId) throw new BadRequestException('Only the mission creator can confirm the mission');
      if (mission.status !== MissionStatus.CREATED) throw new BadRequestException('Mission can only be confirmed if in CREATED status');

      // TODO: Integrate actual payment processing here
      // For now, simulate payment confirmation by changing status
      const updatedMission = await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: MissionStatus.SEARCHING_CARRIER,
        },
      });

      return {
        success: true,
        message: 'Mission confirmed successfully',
        data: updatedMission,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getShipperDashboard(shipperId: string) {
    try {
      const newOffers = await this.prisma.missionAcceptance.findMany({
        where: {
          mission: { shipper_id: shipperId, status: MissionStatus.SEARCHING_CARRIER },
          status: 'PENDING',
        },
        include: {
          mission: true,
          carrier: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
              total_reviews: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      const inProgressMissions = await this.prisma.mission.findMany({
        where: {
          shipper_id: shipperId,
          status: {
            in: [MissionStatus.ACCEPTED, MissionStatus.PICKUP_CONFIRMED, MissionStatus.IN_TRANSIT],
          },
        },
        orderBy: { created_at: 'desc' },
      });

      const recentOrders = await this.prisma.mission.findMany({
        where: {
          shipper_id: shipperId,
          status: {
            in: [MissionStatus.DELIVERED, MissionStatus.COMPLETED, MissionStatus.CANCELLED, MissionStatus.DISPUTED],
          },
        },
        orderBy: { created_at: 'desc' },
        take: 5,
      });

      return {
        success: true,
        data: {
          newOffers,
          inProgressMissions,
          recentOrders,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getAcceptedCarriersForMission(missionId: string, shipperId: string) {
    try {
      const mission = await this.prisma.mission.findUnique({ where: { id: missionId } });
      if (!mission) throw new NotFoundException('Mission not found');
      if (mission.shipper_id !== shipperId) throw new BadRequestException('Only the mission creator can view accepted carriers');

      const acceptedCarriers = await this.prisma.missionAcceptance.findMany({
        where: {
          mission_id: missionId,
          status: 'PENDING', // Carriers who have accepted and are awaiting shipper's decision
        },
        include: {
          carrier: {
            select: {
              id: true,
              name: true,
              avatar: true,
              average_rating: true,
              total_reviews: true,
              vehicles: true, // Include carrier's vehicles
            },
          },
        },
        orderBy: { created_at: 'asc' },
      });

      return {
        success: true,
        data: acceptedCarriers,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async selectCarrier(missionId: string, carrierId: string, shipperId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const mission = await tx.mission.findUnique({ where: { id: missionId } });
        if (!mission) throw new NotFoundException('Mission not found');
        if (mission.shipper_id !== shipperId) throw new BadRequestException('Only the mission creator can select a carrier');
        if (mission.status !== MissionStatus.SEARCHING_CARRIER) throw new BadRequestException('Carrier can only be selected if mission is in SEARCHING_CARRIER status');
        if (mission.carrier_id) throw new BadRequestException('Mission already has an assigned carrier');

        const acceptance = await tx.missionAcceptance.findUnique({
          where: {
            mission_id_carrier_id: {
              mission_id: missionId,
              carrier_id: carrierId,
            },
          },
        });

        if (!acceptance || acceptance.status !== 'PENDING') {
          throw new BadRequestException('Carrier has not accepted this mission or acceptance is not pending');
        }

        // 1. Update mission with selected carrier and status
        const updatedMission = await tx.mission.update({
          where: { id: missionId },
          data: {
            carrier_id: carrierId,
            status: MissionStatus.ACCEPTED,
          },
        });

        // 2. Mark selected acceptance as ACCEPTED
        await tx.missionAcceptance.update({
          where: { id: acceptance.id },
          data: { status: 'ACCEPTED' },
        });

        // 3. Mark all other pending acceptances for this mission as REJECTED
        await tx.missionAcceptance.updateMany({
          where: {
            mission_id: missionId,
            status: 'PENDING',
            NOT: { carrier_id: carrierId },
          },
          data: { status: 'REJECTED' },
        });

        return {
          success: true,
          message: 'Carrier selected successfully and mission accepted',
          data: updatedMission,
        };
      });
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // Enhanced accept mission method using MissionAcceptance model
  async acceptMissionEnhanced(missionId: string, carrierId: string, acceptMissionDto: AcceptMissionDto) {
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

      // Check if carrier has already accepted this mission
      const existingAcceptance = await this.prisma.missionAcceptance.findUnique({
        where: {
          mission_id_carrier_id: {
            mission_id: missionId,
            carrier_id: carrierId,
          },
        },
      });

      if (existingAcceptance) {
        throw new BadRequestException('You have already accepted this mission');
      }

      // Create mission acceptance record

      const acceptance = await this.prisma.missionAcceptance.create({
        data: {
          mission_id: missionId,
          carrier_id: carrierId,
          message: acceptMissionDto.message,
          status: 'PENDING',
        },
        include: {
          mission: true,
          carrier: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });


      // TODO: Send notification to shipper about new acceptance

      return {
        success: true,
        message: 'Mission acceptance submitted successfully',
        data: acceptance,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }


  private async calculateDistance(pickupAddress: string, deliveryAddress: string): Promise<number> {
    // TODO: Implement actual distance calculation using Google Maps API or similar
    // For now, return a mock distance
    return Math.random() * 100 + 10; // Random distance between 10-110 km
  }
}
